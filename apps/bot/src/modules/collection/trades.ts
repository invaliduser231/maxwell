import { type Card, type Trade, tally } from '@maxwell/core/stores/collection';
import type { GuildContext } from '../../commands/types.js';
import type { ReactionEvent } from '../../platform/types.js';
import { lines } from '../../ui/format.js';
import { confirmEmojis } from '../economy/confirm.js';
import type { Schedule } from '../economy/shop.js';
import { copy } from './copy.js';
import { splitTrade } from './draw.js';
import type { Collection } from './service.js';

const OPEN_LIMIT = 5_000;
const USAGE = 15_000;

export function cardList(ids: readonly string[], cards: ReadonlyMap<string, Card>): string {
  return [...tally(ids)]
    .map(([id, n]) => {
      const card = cards.get(id);
      return `${n > 1 ? `${n}x ` : ''}**${card?.name ?? '?'}** #${card?.number ?? '?'}`;
    })
    .join(', ');
}

export class Trades {
  readonly #open = new Map<string, string>();

  constructor(
    private readonly collection: Collection,
    private readonly schedule: Schedule,
  ) {}

  async load(): Promise<void> {
    const trades = await this.collection.store.openTrades();
    for (const trade of trades) if (trade.messageId) this.#track(trade.messageId, trade.id);
  }

  #track(messageId: string, tradeId: string): void {
    if (this.#open.size >= OPEN_LIMIT) {
      const oldest = this.#open.keys().next().value;
      if (oldest !== undefined) this.#open.delete(oldest);
    }
    this.#open.set(messageId, tradeId);
  }

  async #offer(trade: Trade): Promise<string> {
    const cards = await this.collection.store.cardsByIds(trade.guildId, [
      ...trade.give,
      ...trade.want,
    ]);
    return copy.trade.offer(
      trade.fromUser,
      trade.toUser,
      cardList(trade.give, cards),
      cardList(trade.want, cards),
    );
  }

  async propose(ctx: GuildContext, targetId: string, text: string): Promise<void> {
    const { platform, voice } = ctx.services;
    const store = this.collection.store;
    const config = await this.collection.config(ctx.guildId);
    const fromId = ctx.message.author.id;
    const noise = (content: string) => ctx.reply({ content, deleteAfter: USAGE });

    if (!config.trading.enabled) return void (await noise(copy.trade.off));
    if (targetId === fromId) return void (await noise(copy.trade.self));
    const target = await platform.user(targetId);
    if (!target) return void (await noise(copy.unknownMember));
    if (target.bot) return void (await noise(copy.trade.bot));

    const parsed = splitTrade(text);
    if (!parsed)
      return void (await ctx.reply({
        content: voice.usage(copy.trade.empty, copy.trade.usage(ctx.prefix)),
        deleteAfter: USAGE,
      }));
    if (parsed.give.length === 0 && parsed.want.length === 0)
      return void (await noise(copy.trade.empty));
    const max = config.trading.maxCards;
    if (parsed.give.length > max || parsed.want.length > max)
      return void (await noise(copy.trade.tooMany(max)));

    const known = await store.cardsByNumbers(
      ctx.guildId,
      [...parsed.give, ...parsed.want].map(Number),
    );
    const give = parsed.give.map((ref) => known.get(Number(ref))?.id ?? '');
    const want = parsed.want.map((ref) => known.get(Number(ref))?.id ?? '');
    const mine = await store.ownedCounts(ctx.guildId, fromId, give);
    for (const [ref, n] of tally(parsed.give)) {
      const id = known.get(Number(ref))?.id ?? '';
      if ((mine.get(id) ?? 0) < n) return void (await noise(copy.trade.missing(ref)));
    }
    const theirs = await store.ownedCounts(ctx.guildId, targetId, want);
    for (const [ref, n] of tally(parsed.want)) {
      const id = known.get(Number(ref))?.id ?? '';
      if ((theirs.get(id) ?? 0) < n) return void (await noise(copy.trade.theyLack(targetId, ref)));
    }
    if (
      (await store.openTradeBetween(ctx.guildId, fromId)) ||
      (await store.openTradeBetween(ctx.guildId, targetId))
    ) {
      return void (await noise(copy.trade.busy));
    }

    const until = new Date(Date.now() + config.trading.expiryMinutes * 60_000);
    const trade = await store.createTrade({
      guildId: ctx.guildId,
      channelId: ctx.message.channelId,
      fromUser: fromId,
      toUser: targetId,
      give,
      want,
      expiresAt: until,
    });
    const emojis = confirmEmojis(voice.icons);
    const messageId = await ctx.reply({
      content: lines(
        await this.#offer(trade),
        copy.trade.confirm(emojis.yesLabel, emojis.noLabel, until),
      ),
      mentionUsers: [targetId],
    });
    await store.setTradeMessage(trade.id, messageId);
    this.#track(messageId, trade.id);
    await this.schedule('tradeExpire', {
      guildId: ctx.guildId,
      runAt: until,
      payload: { tradeId: trade.id },
      dedupeKey: `collection.trade:${trade.id}`,
    });
    await platform.react(ctx.message.channelId, messageId, emojis.yes);
    await platform.react(ctx.message.channelId, messageId, emojis.no);
  }

  async onReaction(reaction: ReactionEvent): Promise<void> {
    if (reaction.bot) return;
    const tradeId = this.#open.get(reaction.messageId);
    if (!tradeId) return;
    const { voice } = this.collection.services;
    const emojis = confirmEmojis(voice.icons);
    if (reaction.emoji !== emojis.yes && reaction.emoji !== emojis.no) return;
    const store = this.collection.store;
    const trade = await store.trade(tradeId);
    if (trade?.status !== 'open') {
      this.#open.delete(reaction.messageId);
      return;
    }
    if (reaction.userId !== trade.fromUser && reaction.userId !== trade.toUser) return;

    if (reaction.emoji === emojis.no) {
      const closed = await store.closeTrade(trade.id, 'cancelled');
      if (closed) await this.#finish(closed, copy.trade.cancelled(reaction.userId));
      return;
    }

    const confirmed = await store.confirmTrade(trade.id, reaction.userId);
    if (!confirmed?.fromOk || !confirmed.toOk) return;
    const outcome = await store.executeTrade(trade.id);
    if (outcome === 'closed') return;
    if (outcome === 'missing') {
      await this.#finish(confirmed, copy.trade.failed);
      return;
    }
    await this.#finish(confirmed, `${voice.icon('ok')}${copy.trade.done}`);
    await this.#announceSets(confirmed);
  }

  async expire(tradeId: string): Promise<void> {
    const closed = await this.collection.store.closeTrade(tradeId, 'expired');
    if (closed) await this.#finish(closed, copy.trade.expired);
  }

  async #finish(trade: Trade, status: string): Promise<void> {
    const { platform, voice, log } = this.collection.services;
    if (!trade.messageId) return;
    this.#open.delete(trade.messageId);
    const emojis = confirmEmojis(voice.icons);
    try {
      await platform.edit(
        trade.channelId,
        trade.messageId,
        lines(await this.#offer(trade), status),
      );
      for (const emoji of [emojis.yes, emojis.no]) {
        await platform.unreact(trade.channelId, trade.messageId, emoji).catch(() => {});
      }
    } catch (error) {
      log.info({ err: error, guild: trade.guildId }, 'trade message gone');
    }
  }

  async #announceSets(trade: Trade): Promise<void> {
    const { platform, log } = this.collection.services;
    const config = await this.collection.config(trade.guildId);
    const cards = await this.collection.store.cardsByIds(trade.guildId, [
      ...trade.give,
      ...trade.want,
    ]);
    const pick = (ids: readonly string[]) =>
      ids.map((id) => cards.get(id)).filter((card): card is Card => card !== undefined);
    const done: string[] = [];
    for (const [userId, ids] of [
      [trade.toUser, trade.give],
      [trade.fromUser, trade.want],
    ] as const) {
      const sets = await this.collection.checkSets(trade.guildId, userId, pick(ids), config);
      done.push(...sets.map((set) => copy.sets.completedBy(userId, set.name, set.rewards)));
    }
    if (done.length === 0) return;
    await platform
      .send(trade.channelId, { content: lines(...done), silent: true })
      .catch((error) => log.info({ err: error, guild: trade.guildId }, 'set announcement failed'));
  }
}
