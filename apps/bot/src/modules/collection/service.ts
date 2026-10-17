import { type CollectionConfig, collectionConfig } from '@maxwell/core/modules/collection';
import { type Card, CollectionStore, type PoolCard } from '@maxwell/core/stores/collection';
import type { CardStyle } from '../../cards/theme.js';
import { mention } from '../../commands/mentions.js';
import type { Services } from '../../services.js';
import { money, type Wallets } from '../economy/wallets.js';
import { copy } from './copy.js';
import { setCards, setProgress } from './draw.js';
import { enabledDecks, Faces } from './faces.js';

export const MODULE = 'collection';
const POOL_TTL = 60_000;
const POOL_LIMIT = 1_000;

export interface SetDone {
  name: string;
  rewards: string[];
}

export class Collection {
  readonly store: CollectionStore;
  readonly faces: Faces;
  readonly #pools = new Map<string, { cards: PoolCard[]; at: number }>();

  constructor(
    readonly services: Services,
    readonly wallets: Wallets,
  ) {
    this.store = new CollectionStore(services.sql);
    this.faces = new Faces(services, this.store);
  }

  config(guildId: string): Promise<CollectionConfig> {
    return this.services.settings.config(guildId, MODULE, collectionConfig);
  }

  style(guildId: string): Promise<CardStyle> {
    return this.services.cards.forGuild(guildId);
  }

  async pool(
    guildId: string,
    config: CollectionConfig,
    deck: string | null = null,
  ): Promise<PoolCard[]> {
    const decks = enabledDecks(config, deck);
    let hit = this.#pools.get(guildId);
    if (!hit || Date.now() - hit.at > POOL_TTL) {
      const cards = await this.store.pool(guildId, enabledDecks(config));
      if (this.#pools.size >= POOL_LIMIT) this.#pools.clear();
      hit = { cards, at: Date.now() };
      this.#pools.set(guildId, hit);
    }
    const allowed = new Set(decks);
    return hit.cards.filter((card) => allowed.has(card.deck));
  }

  invalidate(guildId: string): void {
    this.#pools.delete(guildId);
  }

  async resolveCard(guildId: string, query: string): Promise<Card | null> {
    const text = query.trim();
    const number = /^#?(\d{1,10})$/.exec(text)?.[1];
    if (number) {
      const card = await this.store.cardByNumber(guildId, Number(number));
      if (card) return card;
    }
    const [match] = await this.store.findCards(guildId, text, 1);
    return match ?? null;
  }

  async checkSets(
    guildId: string,
    userId: string,
    touched: readonly Card[],
    config: CollectionConfig,
  ): Promise<SetDone[]> {
    if (touched.length === 0 || config.sets.length === 0) return [];
    const ids = new Set(touched.map((card) => card.id));
    const decks = new Set(touched.map((card) => card.deck));
    const relevant = config.sets.filter(
      (set) =>
        set.cardIds.some((id) => ids.has(id)) || (set.deckId !== null && decks.has(set.deckId)),
    );
    if (relevant.length === 0) return [];

    const done = await this.store.setsDone(guildId, userId);
    const open = relevant.filter((set) => !done.has(set.id));
    if (open.length === 0) return [];

    const owned = await this.store.ownedIds(guildId, userId);
    const deckCards = new Map<string, string[]>();
    for (const set of open) {
      if (set.deckId && !deckCards.has(set.deckId)) {
        const cards = await this.store.cards(guildId, { deck: set.deckId, activeOnly: true });
        deckCards.set(
          set.deckId,
          cards.map((card) => card.id),
        );
      }
    }

    const finished: SetDone[] = [];
    for (const set of open) {
      const cards = setCards(set, deckCards);
      if (cards.length === 0 || setProgress(cards, owned) < cards.length) continue;
      if (!(await this.store.markSetDone(guildId, userId, set.id))) continue;
      finished.push({ name: set.name, rewards: await this.#reward(guildId, userId, set) });
    }
    return finished;
  }

  async #reward(
    guildId: string,
    userId: string,
    set: CollectionConfig['sets'][number],
  ): Promise<string[]> {
    const { platform, log } = this.services;
    const parts: string[] = [];
    if (set.rewardAmount > 0 && (await this.wallets.active(guildId))) {
      const economy = await this.wallets.config(guildId);
      await this.wallets.ensure(guildId, userId, economy);
      await this.wallets.store.credit(guildId, userId, set.rewardAmount, 'set', { ref: set.id });
      parts.push(`+${money(set.rewardAmount, economy.currency)}`);
    }
    if (set.rewardRoleId) {
      try {
        await platform.addRole(guildId, userId, set.rewardRoleId, copy.sets.roleReason(set.name));
        parts.push(mention.role(set.rewardRoleId));
      } catch (error) {
        log.warn({ err: error, guild: guildId, set: set.id }, 'set reward role failed');
      }
    }
    return parts;
  }
}
