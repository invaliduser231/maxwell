import type { Duel } from '@maxwell/core/stores/games';
import type { GuildContext } from '../../commands/types.js';
import type { ReactionEvent } from '../../platform/types.js';
import { lines } from '../../ui/format.js';
import { confirmEmojis } from '../economy/confirm.js';
import type { Schedule } from '../economy/shop.js';
import { type Currency, money } from '../economy/wallets.js';
import { copy } from './copy.js';
import { flip } from './logic.js';
import type { Games } from './service.js';

const OPEN_LIMIT = 5_000;
const USAGE = 15_000;

export class Coinflip {
  readonly #open = new Map<string, string>();

  constructor(
    private readonly games: Games,
    private readonly schedule: Schedule,
  ) {}

  async load(): Promise<void> {
    for (const duel of await this.games.store.openDuels()) {
      if (duel.messageId) this.#track(duel.messageId, duel.id);
    }
  }

  #track(messageId: string, duelId: string): void {
    if (this.#open.size >= OPEN_LIMIT) {
      const oldest = this.#open.keys().next().value;
      if (oldest !== undefined) this.#open.delete(oldest);
    }
    this.#open.set(messageId, duelId);
  }

  async run(
    ctx: GuildContext,
    targetId: string | undefined,
    stake: number | undefined,
  ): Promise<void> {
    const config = await this.games.config(ctx.guildId);
    if (!(await this.games.allowed(ctx, config.coinflip.enabled, copy.names.coinflip))) return;
    if (!targetId) {
      await ctx.reply(flip() === 'heads' ? copy.coinflip.heads : copy.coinflip.tails);
      return;
    }
    const { platform, voice } = ctx.services;
    const fromId = ctx.message.author.id;
    const noise = (content: string) => ctx.reply({ content, deleteAfter: USAGE });
    if (targetId === fromId) return void (await noise(copy.coinflip.self));
    const target = await platform.user(targetId);
    if (!target) return void (await noise(copy.unknownMember));
    if (target.bot) return void (await noise(copy.coinflip.bot));

    let currency: Currency | null = null;
    if (stake) {
      const check = await this.games.checkStake(ctx, stake, [fromId]);
      if (!check.ok) return;
      currency = check.currency;
    }
    const store = this.games.store;
    if (
      (await store.openDuelFor(ctx.guildId, fromId)) ||
      (await store.openDuelFor(ctx.guildId, targetId))
    ) {
      return void (await noise(copy.coinflip.busy));
    }

    const until = new Date(Date.now() + config.coinflip.expirySeconds * 1000);
    const duel = await store.createDuel({
      guildId: ctx.guildId,
      channelId: ctx.message.channelId,
      challenger: fromId,
      opponent: targetId,
      stake: stake ?? 0,
      expiresAt: until,
    });
    const emojis = confirmEmojis(voice.icons);
    const messageId = await ctx.reply({
      content: lines(
        this.#challenge(duel, currency),
        copy.coinflip.confirm(emojis.yesLabel, emojis.noLabel, until),
      ),
      mentionUsers: [targetId],
    });
    await store.setDuelMessage(duel.id, messageId);
    this.#track(messageId, duel.id);
    await this.schedule('duelExpire', {
      guildId: ctx.guildId,
      runAt: until,
      payload: { duelId: duel.id },
      dedupeKey: `games.duel:${duel.id}`,
    });
    await platform.react(ctx.message.channelId, messageId, emojis.yes);
    await platform.react(ctx.message.channelId, messageId, emojis.no);
  }

  #challenge(duel: Duel, currency: Currency | null): string {
    const stake = duel.stake > 0 && currency ? money(duel.stake, currency) : null;
    return copy.coinflip.challenge(duel.challenger, duel.opponent, stake);
  }

  async onReaction(reaction: ReactionEvent): Promise<void> {
    if (reaction.bot) return;
    const duelId = this.#open.get(reaction.messageId);
    if (!duelId) return;
    const { voice } = this.games.services;
    const emojis = confirmEmojis(voice.icons);
    if (reaction.emoji !== emojis.yes && reaction.emoji !== emojis.no) return;
    const store = this.games.store;
    const duel = await store.duel(duelId);
    if (duel?.status !== 'open') {
      this.#open.delete(reaction.messageId);
      return;
    }
    const isOpponent = reaction.userId === duel.opponent;
    const isChallenger = reaction.userId === duel.challenger;
    if (!isOpponent && !isChallenger) return;

    if (reaction.emoji === emojis.no) {
      const closed = await store.closeDuel(duel.id, isOpponent ? 'declined' : 'cancelled');
      if (closed) {
        await this.#finish(
          closed,
          isOpponent ? copy.coinflip.declined(reaction.userId) : copy.coinflip.cancelled,
        );
      }
      return;
    }
    if (!isOpponent) return;

    const side = flip();
    const winner = side === 'heads' ? duel.challenger : duel.opponent;
    const loser = winner === duel.challenger ? duel.opponent : duel.challenger;
    const closed = await store.closeDuel(duel.id, 'done', winner);
    if (!closed) return;

    const currency = closed.stake > 0 ? await this.games.currency(closed.guildId) : null;
    if (closed.stake > 0) {
      const settled =
        currency !== null &&
        (await this.games.wallets.store.exchange(closed.guildId, [
          {
            userId: closed.challenger,
            delta: -closed.stake,
            kind: 'stake',
            ref: 'coinflip',
            counterpartId: closed.opponent,
          },
          {
            userId: closed.opponent,
            delta: -closed.stake,
            kind: 'stake',
            ref: 'coinflip',
            counterpartId: closed.challenger,
          },
          {
            userId: winner,
            delta: closed.stake * 2,
            kind: 'game',
            ref: 'coinflip',
            counterpartId: loser,
          },
        ]));
      if (!settled) {
        await store.markDuel(closed.id, 'failed');
        await this.#finish(closed, copy.coinflip.failed);
        return;
      }
    }
    await store.score(closed.guildId, 'coinflip', winner, { win: true, net: closed.stake });
    await store.score(closed.guildId, 'coinflip', loser, { net: -closed.stake });
    const pot = closed.stake > 0 && currency ? money(closed.stake * 2, currency) : null;
    await this.#finish(
      closed,
      copy.coinflip.won(side === 'heads' ? copy.coinflip.heads : copy.coinflip.tails, winner, pot),
    );
  }

  async expire(guildId: string, duelId: string): Promise<void> {
    const closed = await this.games.store.closeDuel(duelId, 'expired', null, guildId);
    if (closed) await this.#finish(closed, copy.coinflip.expired);
  }

  async #finish(duel: Duel, status: string): Promise<void> {
    const { platform, voice, log } = this.games.services;
    if (!duel.messageId) return;
    this.#open.delete(duel.messageId);
    const currency = duel.stake > 0 ? await this.games.currency(duel.guildId) : null;
    const emojis = confirmEmojis(voice.icons);
    try {
      await platform.edit(duel.channelId, duel.messageId, {
        content: lines(this.#challenge(duel, currency), status),
        mentionUsers: [],
      });
      for (const emoji of [emojis.yes, emojis.no]) {
        await platform.unreact(duel.channelId, duel.messageId, emoji).catch(() => {});
      }
    } catch (error) {
      log.info({ err: error, guild: duel.guildId }, 'coinflip message gone');
    }
  }
}
