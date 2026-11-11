import type { HiloSession } from '@maxwell/core/stores/games';
import type { GuildContext } from '../../commands/types.js';
import type { IncomingMessage, ReactionEvent } from '../../platform/types.js';
import { lines, subtext } from '../../ui/format.js';
import type { Schedule } from '../economy/shop.js';
import { type Currency, money } from '../economy/wallets.js';
import { copy } from './copy.js';
import { type Guess, nextMultiplier, nextNumber, parseGuess, payout } from './logic.js';
import { key, pressed, Seats } from './seats.js';
import type { Games } from './service.js';

const ACTIVE_LIMIT = 10_000;
const REWARD_STREAK = 3;

const keys = { up: key(0x2b06), down: key(0x2b07), stop: key(0x23f9) };
const guesses = { up: 'higher', down: 'lower', stop: 'stop' } as const;
const all = Object.values(keys);

interface Turn {
  text: string;
  done: boolean;
  session: HiloSession;
}

export class HigherLower {
  readonly #active = new Map<string, string>();
  readonly #seats: Seats;

  constructor(
    private readonly games: Games,
    private readonly schedule: Schedule,
  ) {
    this.#seats = new Seats(() => games.services.platform);
  }

  async load(): Promise<void> {
    for (const session of await this.games.store.activeHilo()) {
      this.#track(session.guildId, session.userId, session.channelId);
      if (session.messageId) {
        this.#seats.sit(session.messageId, {
          guildId: session.guildId,
          userId: session.userId,
          tidy: false,
        });
      }
    }
  }

  #track(guildId: string, userId: string, channelId: string): void {
    if (this.#active.size >= ACTIVE_LIMIT) {
      const oldest = this.#active.keys().next().value;
      if (oldest !== undefined) this.#active.delete(oldest);
    }
    this.#active.set(`${guildId}:${userId}`, channelId);
  }

  #forget(guildId: string, userId: string, messageId: string | null | undefined): void {
    this.#active.delete(`${guildId}:${userId}`);
    this.#seats.leave(messageId);
  }

  async #expireAt(session: Pick<HiloSession, 'guildId' | 'userId'>, at: Date): Promise<void> {
    await this.schedule('hiloExpire', {
      guildId: session.guildId,
      runAt: at,
      payload: { userId: session.userId },
      dedupeKey: `games.hilo:${session.guildId}:${session.userId}:${at.getTime()}`,
    });
  }

  #how(until: Date): string {
    return subtext(copy.hilo.how(until, keys));
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
    const channelId = ctx.message.channelId;
    const messageId = await ctx.reply(
      lines(
        copy.hilo.start(current, rules.max, stake && currency ? money(stake, currency) : null),
        this.#how(until),
      ),
    );
    await store.setHiloMessage(ctx.guildId, userId, messageId);
    await this.#seats.open(ctx.guildId, channelId, messageId, userId, all);
  }

  async onMessage(message: IncomingMessage): Promise<void> {
    const guildId = message.guildId;
    if (!guildId || message.author.bot) return;
    const userId = message.author.id;
    if (this.#active.get(`${guildId}:${userId}`) !== message.channelId) return;
    const guess = parseGuess(message.content);
    if (!guess) return;
    const turn = await this.#play(guildId, userId, guess);
    if (!turn) return;
    await this.games.services.platform.reply(message, turn.text);
    await this.#show(turn);
  }

  async onReaction(reaction: ReactionEvent, added: boolean): Promise<void> {
    const name = pressed(reaction.emoji, keys);
    if (!name) return;
    const seat = await this.#seats.press(reaction, added);
    if (!seat) return;
    const turn = await this.#play(seat.guildId, seat.userId, guesses[name]);
    if (turn) await this.#show(turn);
  }

  async #show(turn: Turn): Promise<void> {
    const { channelId, messageId } = turn.session;
    if (!messageId) return;
    const { platform } = this.games.services;
    await platform.edit(channelId, messageId, turn.text).catch(() => {});
    if (turn.done) await this.#seats.close(channelId, messageId, all);
  }

  async #play(guildId: string, userId: string, guess: Guess): Promise<Turn | null> {
    const store = this.games.store;
    const session = await store.hilo(guildId, userId);
    if (!session) {
      this.#active.delete(`${guildId}:${userId}`);
      return null;
    }
    if (guess === 'stop') {
      const settled = await this.#settle(guildId, userId, false);
      return settled ? { text: settled.text, done: true, session: settled.session } : null;
    }

    const config = await this.games.config(guildId);
    const rules = config.higherLower;
    const next = nextNumber(session.current, rules.max);
    const right = guess === 'higher' ? next > session.current : next < session.current;
    const currency = session.stake > 0 ? await this.games.currency(guildId) : null;

    if (!right) {
      const ended = await store.endHilo(guildId, userId);
      if (!ended) return null;
      this.#forget(guildId, userId, ended.messageId);
      await store.score(guildId, 'higherlower', userId, { best: ended.streak, net: -ended.stake });
      const lost = ended.stake > 0 && currency ? money(ended.stake, currency) : null;
      return { text: copy.hilo.wrong(next, ended.streak, lost), done: true, session: ended };
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
    if (!moved) return null;
    await this.#expireAt(session, until);
    const worth =
      session.stake > 0 && currency ? money(payout(session.stake, multiplier), currency) : null;
    return {
      text: lines(copy.hilo.right(next, streak, worth), this.#how(until)),
      done: false,
      session,
    };
  }

  async expire(guildId: string, userId: string): Promise<void> {
    const settled = await this.#settle(guildId, userId, true);
    if (!settled) return;
    const text = copy.hilo.timeout(userId, settled.text);
    if (settled.session.messageId) {
      await this.#show({ text, done: true, session: settled.session });
      return;
    }
    const { platform, log } = this.games.services;
    await platform
      .send(settled.session.channelId, text)
      .catch((error) => log.info({ err: error, guild: guildId }, 'hilo channel gone'));
  }

  async #settle(
    guildId: string,
    userId: string,
    timedOut: boolean,
  ): Promise<{ text: string; session: HiloSession } | null> {
    const ended = await this.games.store.endHilo(guildId, userId, timedOut);
    if (!ended) return null;
    this.#forget(guildId, userId, ended.messageId);
    return { text: await this.#payout(guildId, userId, ended), session: ended };
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
