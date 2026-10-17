import type { CollectionConfig } from '@maxwell/core/modules/collection';
import type { Card } from '@maxwell/core/stores/collection';
import type { Embed, IncomingMessage } from '../../platform/types.js';
import { lines } from '../../ui/format.js';
import type { Schedule } from '../economy/shop.js';
import { copy } from './copy.js';
import { drawOne, tierOf } from './draw.js';
import { deckName } from './faces.js';
import { renderCard } from './render.js';
import type { Collection } from './service.js';

const COUNTER_LIMIT = 5_000;

export type DropResult = 'sent' | 'no_pool' | 'no_permission' | 'failed';

export function hexColor(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

export function cardFile(card: Card): string {
  return `card-${card.number}.png`;
}

export function dropEmbed(
  card: Card,
  config: CollectionConfig,
  state:
    | { kind: 'open'; command: string; until: Date }
    | { kind: 'claimed'; userId: string }
    | { kind: 'expired' },
): Embed {
  const tier = tierOf(config.tiers, card.rarity);
  const status =
    state.kind === 'open'
      ? copy.drop.hint(state.command, state.until)
      : state.kind === 'claimed'
        ? copy.drop.claimed(state.userId)
        : copy.drop.expired;
  return {
    color: hexColor(tier.color),
    title: copy.drop.title,
    description: lines(
      `**${card.name}**`,
      `${tier.name}, ${deckName(config, card.deck)}`,
      '',
      status,
    ),
    imageUrl: `attachment://${cardFile(card)}`,
  };
}

export class Drops {
  readonly #counters = new Map<string, { count: number; last: number }>();

  constructor(
    private readonly collection: Collection,
    private readonly schedule: Schedule,
  ) {}

  async onMessage(message: IncomingMessage): Promise<void> {
    const guildId = message.guildId;
    if (!guildId || message.author.bot || message.fromWebhook) return;
    const config = await this.collection.config(guildId);
    const rules = config.drops;
    if (!rules.enabled || !rules.channelIds.includes(message.channelId)) return;

    const key = `${guildId}:${message.channelId}`;
    const now = Date.now();
    const counter = this.#counters.get(key) ?? { count: 0, last: 0 };
    counter.count += 1;
    this.#counters.delete(key);
    this.#counters.set(key, counter);
    if (this.#counters.size > COUNTER_LIMIT) {
      const oldest = this.#counters.keys().next().value;
      if (oldest !== undefined) this.#counters.delete(oldest);
    }
    if (counter.count < rules.everyMessages || now - counter.last < rules.minMinutes * 60_000)
      return;
    counter.count = 0;
    counter.last = now;
    await this.drop(guildId, message.channelId, null, config);
  }

  async drop(
    guildId: string,
    channelId: string,
    cardId: string | null,
    known?: CollectionConfig,
  ): Promise<DropResult> {
    const { platform, log, guilds } = this.collection.services;
    const store = this.collection.store;
    const config = known ?? (await this.collection.config(guildId));

    const missing = await platform.missingBotPermissions(guildId, channelId, [
      'SendMessages',
      'EmbedLinks',
      'AttachFiles',
    ]);
    if (missing.length) {
      log.info({ guild: guildId, channel: channelId, missing }, 'drop channel unusable');
      return 'no_permission';
    }

    let card: Card | null = null;
    if (cardId) {
      card = await store.card(guildId, cardId);
    } else {
      const picked = drawOne(await this.collection.pool(guildId, config), config.tiers);
      card = picked ? await store.card(guildId, picked.id) : null;
    }
    if (!card) return 'no_pool';

    const until = new Date(Date.now() + config.drops.claimMinutes * 60_000);
    const drop = await store.createDrop(guildId, channelId, card.id, until);
    try {
      const style = await this.collection.style(guildId);
      const face = await this.collection.faces.face(guildId, card, config, style);
      const image = await renderCard(face, style);
      const wishers = await store.wishers(guildId, card.id, 5);
      const prefix = await guilds.prefix(guildId);
      const messageId = await platform.send(channelId, {
        content: wishers.length > 0 ? copy.drop.wished(wishers) : undefined,
        mentionUsers: wishers,
        embeds: [dropEmbed(card, config, { kind: 'open', command: `${prefix}claim`, until })],
        files: [{ name: cardFile(card), data: image }],
      });
      await store.setDropMessage(drop.id, messageId);
      await this.schedule('dropExpire', {
        guildId,
        runAt: until,
        payload: { dropId: drop.id },
        dedupeKey: `collection.drop:${drop.id}`,
      });
      return 'sent';
    } catch (error) {
      log.warn({ err: error, guild: guildId, channel: channelId }, 'card drop failed');
      return 'failed';
    }
  }

  async expire(dropId: string): Promise<void> {
    const { platform, log } = this.collection.services;
    const store = this.collection.store;
    const drop = await store.drop(dropId);
    if (!drop || drop.claimedBy || !drop.messageId) return;
    const card = await store.card(drop.guildId, drop.cardId);
    if (!card) return;
    const config = await this.collection.config(drop.guildId);
    await platform
      .edit(drop.channelId, drop.messageId, {
        embeds: [dropEmbed(card, config, { kind: 'expired' })],
      })
      .catch((error) => log.info({ err: error, guild: drop.guildId }, 'drop message gone'));
  }
}
