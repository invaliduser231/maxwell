import { COMMUNITY_DECK, type CollectionConfig } from '@maxwell/core/modules/collection';
import type { Card, CollectionStore } from '@maxwell/core/stores/collection';
import { type Image, loadImage } from '@napi-rs/canvas';
import { loadAvatar } from '../../cards/avatar.js';
import type { CardStyle } from '../../cards/theme.js';
import type { Services } from '../../services.js';
import { copy } from './copy.js';
import { tierOf } from './draw.js';
import type { CardFace } from './render.js';

const LIMIT = 200;
const TTL = 10 * 60_000;

export function deckName(config: CollectionConfig, deck: string): string {
  if (deck === COMMUNITY_DECK) return copy.communityDeck;
  return config.decks.find((d) => d.id === deck)?.name ?? deck;
}

export function enabledDecks(config: CollectionConfig, only: string | null = null): string[] {
  const decks = config.decks.filter((deck) => deck.enabled).map((deck) => deck.id);
  if (config.community.enabled) decks.push(COMMUNITY_DECK);
  return only ? decks.filter((deck) => deck === only) : decks;
}

export class Faces {
  readonly #images = new Map<string, { image: Image | null; at: number }>();

  constructor(
    private readonly services: Services,
    private readonly store: CollectionStore,
  ) {}

  async face(
    guildId: string,
    card: Card,
    config: CollectionConfig,
    style: CardStyle,
  ): Promise<CardFace> {
    const tier = tierOf(config.tiers, card.rarity);
    return {
      number: card.number,
      name: card.name,
      deck: deckName(config, card.deck),
      rarity: { name: tier.name, color: tier.color },
      image: await this.#image(guildId, card, style),
    };
  }

  async faces(
    guildId: string,
    cards: readonly Card[],
    config: CollectionConfig,
    style: CardStyle,
  ): Promise<CardFace[]> {
    return Promise.all(cards.map((card) => this.face(guildId, card, config, style)));
  }

  async #image(guildId: string, card: Card, style: CardStyle): Promise<Image | null> {
    if (card.memberId) {
      const user = await this.services.platform.user(card.memberId).catch(() => null);
      return loadAvatar(user?.avatarUrl ?? null, card.name, style.theme);
    }
    if (!card.assetKey) return null;
    const key = `${guildId}:${card.assetKey}`;
    const hit = this.#images.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.image;
    let image: Image | null = null;
    try {
      const data = await this.store.asset(guildId, card.assetKey);
      image = data ? await loadImage(data) : null;
    } catch (error) {
      this.services.log.warn(
        { err: error, guild: guildId, card: card.id },
        'card image unreadable',
      );
    }
    if (this.#images.size >= LIMIT) {
      const oldest = this.#images.keys().next().value;
      if (oldest !== undefined) this.#images.delete(oldest);
    }
    this.#images.set(key, { image, at: Date.now() });
    return image;
  }
}
