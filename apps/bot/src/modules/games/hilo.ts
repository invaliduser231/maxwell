import type { HiloSession } from '@maxwell/core/stores/games';
import type { GuildContext } from '../../commands/types.js';
import type { IncomingMessage } from '../../platform/types.js';
import { lines, subtext } from '../../ui/format.js';
import type { Schedule } from '../economy/shop.js';
import { type Currency, money } from '../economy/wallets.js';
import { copy } from './copy.js';
import { nextMultiplier, nextNumber, parseGuess, payout } from './logic.js';
import type { Games } from './service.js';

const ACTIVE_LIMIT = 10_000;
const REWARD_STREAK = 3;

export class HigherLower {
  readonly #active = new Map<string, string>();

  constructor(
    private readonly games: Games,
    private readonly schedule: Schedule,
  ) {}

  async load(): Promise<void> {
    for (const session of await this.games.store.activeHilo()) {
      this.#track(session.guildId, session.userId, session.channelId);
    }
  }

  #track(guildId: string, userId: string, channelId: string): void {
    if (this.#active.size >= ACTIVE_LIMIT) {
      const oldest = this.#active.keys().next().value;
      if (oldest !== undefined) this.#active.delete(oldest);
    }
    this.#active.set(`${guildId}:${userId}`, channelId);
  }

  async #expireAt(session: Pick<HiloSession, 'guildId' | 'userId'>, at: Date): Promise<void> {
    await this.schedule('hiloExpire', {
      guildId: session.guildId,
      runAt: at,
      payload: { userId: session.userId },
      dedupeKey: `games.hilo:${session.guildId}:${session.userId}:${at.getTime()}`,
    });
  }

  async start(ctx: GuildContext, stake: number | undefined): Promise<void> {
    const config = await this.games.config(ctx.guildId);
    const rules = config.higherLower;
    if (!(await this.games.allowed(ctx, rules.enabled, copy.names.higherlower))) return;
    const userId = ctx.message.author.id;
    const store = this.games.store;

    const existing = await store.hilo(ctx.guildId, userId);
    if (existing) {
      if (existing.expiresAt.getTime() > Date.now()) {
        await ctx.reply({ content: copy.hilo.running(existing.channelId), deleteAfter: 15_000 });
        return;
      }
      await this.expire(ctx.guildId, userId);
    }

    let currency: Currency | null = null;
    if (stake) {
      const check = await this.games.checkStake(ctx, stake, [userId]);
      if (!check.ok) return;
      currency = check.currency;
      const paid = await this.games.wallets.store.debit(ctx.guildId, userId, stake, 'stake', {
        ref: 'higherlower',
      });
      if (!paid) {
        const balance = await this.games.wallets.store.balance(ctx.guildId, userId);
        await ctx.reply({ content: copy.broke(money(balance, currency)), deleteAfter: 15_000 });
        return;
      }
    }

    const current = 2 + Math.floor(Math.random() * (rules.max - 2));
    const until = new Date(Date.now() + rules.timeoutSeconds * 1000);
    const session: HiloSession = {
      guildId: ctx.guildId,
      userId,
      channelId: ctx.message.channelId,
      current,
      streak: 0,
      stake: stake ?? 0,
      multiplier: 1,
      expiresAt: until,
    };
    if (!(await store.startHilo(session))) {
      if (stake) {
        await this.games.wallets.store.credit(ctx.guildId, userId, stake, 'refund', {
          ref: 'higherlower',
        });
      }
      await ctx.reply({ content: copy.hilo.running(ctx.message.channelId), deleteAfter: 15_000 });
      return;
    }
    this.#track(ctx.guildId, userId, ctx.message.channelId);
    await this.#expireAt(session, until);
    await ctx.reply(
      lines(
        copy.hilo.start(current, rules.max, stake && currency ? money(stake, currency) : null),
        subtext(copy.hilo.how(until)),
      ),
    );
  }

  async onMessage(message: IncomingMessage): Promise<void> {
    const guildId = message.guildId;
    if (!guildId || message.author.bot) return;
    const userId = message.author.id;
    if (this.#active.get(`${guildId}:${userId}`) !== message.channelId) return;
    const guess = parseGuess(message.content);
    if (!guess) return;
    const { platform } = this.games.services;
    const store = this.games.store;
    const session = await store.hilo(guildId, userId);
    if (!session) {
      this.#active.delete(`${guildId}:${userId}`);
      return;
    }
    if (guess === 'stop') {
      const settled = await this.#settle(guildId, userId, false);
      if (settled) await platform.reply(message, settled.text);
      return;
    }

    const config = await this.games.config(guildId);
    const rules = config.higherLower;
    const next = nextNumber(session.current, rules.max);
    const right = guess === 'higher' ? next > session.current : next < session.current;
    const currency = session.stake > 0 ? await this.games.currency(guildId) : null;

    if (!right) {
      const ended = await store.endHilo(guildId, userId);
      if (!ended) return;
      this.#active.delete(`${guildId}:${userId}`);
      await store.score(guildId, 'higherlower', userId, { best: ended.streak, net: -ended.stake });
      const lost = ended.stake > 0 && currency ? money(ended.stake, currency) : null;
      await platform.reply(message, copy.hilo.wrong(next, ended.streak, lost));
      return;
    }

    const multiplier = nextMultiplier(
      session.multiplier,
      session.current,
      guess,
      rules.max,
      rules.edge,
      rules.maxMultiplier,
    );
    const until = new Date(Date.now() + rules.timeoutSeconds * 1000);
    const streak = session.streak + 1;
    const moved = await store.advanceHilo(guildId, userId, session.streak, {
      current: next,
      streak,
      multiplier,
      expiresAt: until,
    });
    if (!moved) return;
    await this.#expireAt(session, until);
    const worth =
      session.stake > 0 && currency ? money(payout(session.stake, multiplier), currency) : null;
    await platform.reply(
      message,
      lines(copy.hilo.right(next, streak, worth), subtext(copy.hilo.how(until))),
    );
  }

  async expire(guildId: string, userId: string): Promise<void> {
    const settled = await this.#settle(guildId, userId, true);
    if (!settled) return;
    const { platform, log } = this.games.services;
    await platform
      .send(settled.channelId, copy.hilo.timeout(userId, settled.text))
      .catch((error) => log.info({ err: error, guild: guildId }, 'hilo channel gone'));
  }

  async #settle(
    guildId: string,
    userId: string,
    timedOut: boolean,
  ): Promise<{ text: string; channelId: string } | null> {
    const ended = await this.games.store.endHilo(guildId, userId, timedOut);
    if (!ended) return null;
    this.#active.delete(`${guildId}:${userId}`);
    return { text: await this.#payout(guildId, userId, ended), channelId: ended.channelId };
  }

  async #payout(guildId: string, userId: string, ended: HiloSession): Promise<string> {
    const store = this.games.store;
    const wallet = this.games.wallets.store;

    if (ended.stake > 0) {
      const currency = (await this.games.wallets.config(guildId)).currency;
      if (ended.streak === 0) {
        await wallet.credit(guildId, userId, ended.stake, 'refund', { ref: 'higherlower' });
        return copy.hilo.refunded(money(ended.stake, currency));
      }
      const amount = payout(ended.stake, ended.multiplier);
      await wallet.credit(guildId, userId, amount, 'game', { ref: 'higherlower' });
      await store.score(guildId, 'higherlower', userId, {
        win: true,
        best: ended.streak,
        net: amount - ended.stake,
      });
      return copy.hilo.cashed(money(amount, currency), ended.streak);
    }

    const won = ended.streak >= REWARD_STREAK;
    await store.score(guildId, 'higherlower', userId, { win: won, best: ended.streak });
    const reward = won ? await this.games.reward(guildId, userId, 'higherlower') : null;
    return `${copy.hilo.stopped(ended.streak)}${reward ? ` ${reward}.` : ''}`;
  }
}
