import { cardSet, collectionConfig, defaultTiers } from '@maxwell/core/modules/collection';
import type { PoolCard } from '@maxwell/core/stores/collection';
import { describe, expect, it } from 'vitest';
import {
  drawCards,
  drawOne,
  parseCardRefs,
  rarityByActivity,
  setCards,
  setProgress,
  splitTrade,
} from '../../src/modules/collection/draw.js';
import { gridSize, renderCard, renderCards } from '../../src/modules/collection/render.js';

function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

const pool: PoolCard[] = [
  { id: '1', deck: 'community', rarity: 'common' },
  { id: '2', deck: 'community', rarity: 'common' },
  { id: '3', deck: 'beasts', rarity: 'rare' },
  { id: '4', deck: 'beasts', rarity: 'legendary' },
];

describe('collection config', () => {
  it('parses an empty config with defaults', () => {
    const config = collectionConfig.parse({});
    expect(config.tiers.map((tier) => tier.id)).toEqual(defaultTiers.map((tier) => tier.id));
    expect(config.packs[0]?.id).toBe('standard');
    expect(config.drops.enabled).toBe(false);
  });
});

describe('drawing', () => {
  it('picks a tier by weight among tiers that have cards', () => {
    expect(drawOne(pool, defaultTiers, sequence(0, 0))?.rarity).toBe('common');
    expect(drawOne(pool, defaultTiers, sequence(0.999, 0))?.rarity).toBe('legendary');
  });

  it('guarantees the minimum tier on the last card', () => {
    const cards = drawCards(pool, defaultTiers, 3, 'rare', sequence(0, 0));
    expect(cards).toHaveLength(3);
    expect(cards.at(-1)?.rarity).toBe('rare');
  });

  it('returns nothing from an empty pool', () => {
    expect(drawOne([], defaultTiers)).toBeNull();
    expect(drawCards([], defaultTiers, 3, null)).toEqual([]);
  });

  it('treats unknown rarities as the first tier', () => {
    const odd: PoolCard[] = [{ id: '9', deck: 'x', rarity: 'mythic' }];
    expect(drawOne(odd, defaultTiers, sequence(0.5, 0))?.id).toBe('9');
  });
});

describe('rarity by activity', () => {
  it('gives the most active members the rarest tiers', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ cardId: String(i), messages: 100 - i }));
    const result = rarityByActivity(rows, defaultTiers);
    expect(result.get('0')).toBe('legendary');
    expect(result.get('3')).toBe('epic');
    expect(result.get('10')).toBe('rare');
    expect(result.get('30')).toBe('uncommon');
    expect(result.get('99')).toBe('common');
  });

  it('keeps silent members common', () => {
    const result = rarityByActivity([{ cardId: 'a', messages: 0 }], defaultTiers);
    expect(result.get('a')).toBe('common');
  });
});

describe('trade parsing', () => {
  it('reads card ids on both sides', () => {
    expect(parseCardRefs('#12 14, #15')).toEqual(['12', '14', '15']);
    expect(parseCardRefs('#012 7')).toEqual(['12', '7']);
    expect(splitTrade('#12 #14 for #33')).toEqual({ give: ['12', '14'], want: ['33'] });
    expect(splitTrade('for #33')).toEqual({ give: [], want: ['33'] });
    expect(splitTrade('#12 por #33')).toEqual({ give: ['12'], want: ['33'] });
    expect(splitTrade('#12')).toEqual({ give: ['12'], want: [] });
  });

  it('rejects anything that is not a card id', () => {
    expect(splitTrade('#12 dragon for #3')).toBeNull();
    expect(splitTrade('#1 for #2 for #3')).toBeNull();
  });
});

describe('sets', () => {
  it('combines listed cards and whole decks', () => {
    const set = cardSet.parse({ id: 'beasts', name: 'Beasts', deckId: 'beasts', cardIds: ['1'] });
    const cards = setCards(set, new Map([['beasts', ['3', '4']]]));
    expect(cards.sort()).toEqual(['1', '3', '4']);
    expect(setProgress(cards, new Set(['1', '4', '99']))).toBe(2);
  });
});

describe('card renderer', () => {
  const face = {
    number: 12,
    name: 'A rather long card name that needs to fit',
    deck: 'Community',
    rarity: { name: 'Legendary', color: '#F26B3A' },
    image: null,
  };

  it('renders a single card as png', async () => {
    const png = await renderCard(face);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });

  it('lays out several cards in a grid', async () => {
    expect(gridSize(3).columns).toBe(3);
    expect(gridSize(7).columns).toBe(5);
    expect(gridSize(7).height).toBeGreaterThan(gridSize(3).height);
    const png = await renderCards([face, { ...face, number: 13 }]);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });
});
