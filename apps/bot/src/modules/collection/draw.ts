import type { CardSet, RarityTier } from '@maxwell/core/modules/collection';
import type { PoolCard } from '@maxwell/core/stores/collection';

export type Random = () => number;

function pickWeighted<T>(
  items: readonly T[],
  weight: (item: T) => number,
  random: Random,
): T | null {
  const total = items.reduce((sum, item) => sum + Math.max(weight(item), 0), 0);
  if (total <= 0) return items[0] ?? null;
  let roll = random() * total;
  for (const item of items) {
    roll -= Math.max(weight(item), 0);
    if (roll < 0) return item;
  }
  return items.at(-1) ?? null;
}

export function tierOf(tiers: readonly RarityTier[], id: string): RarityTier {
  return tiers.find((tier) => tier.id === id) ?? (tiers[0] as RarityTier);
}

export function drawOne(
  pool: readonly PoolCard[],
  tiers: readonly RarityTier[],
  random: Random = Math.random,
  minTier: string | null = null,
): PoolCard | null {
  if (pool.length === 0) return null;
  const known = new Set(tiers.map((tier) => tier.id));
  const byTier = new Map<string, PoolCard[]>();
  for (const card of pool) {
    const key = known.has(card.rarity) ? card.rarity : (tiers[0]?.id ?? card.rarity);
    const list = byTier.get(key) ?? [];
    list.push(card);
    byTier.set(key, list);
  }
  const floor = minTier ? tiers.findIndex((tier) => tier.id === minTier) : -1;
  let candidates = tiers.filter((tier, index) => byTier.has(tier.id) && index >= floor);
  if (candidates.length === 0) candidates = tiers.filter((tier) => byTier.has(tier.id));
  const tier = pickWeighted(candidates, (t) => t.weight, random);
  const cards = tier ? (byTier.get(tier.id) ?? []) : [];
  if (cards.length === 0) return pool[Math.floor(random() * pool.length)] ?? null;
  return cards[Math.min(Math.floor(random() * cards.length), cards.length - 1)] ?? null;
}

export function drawCards(
  pool: readonly PoolCard[],
  tiers: readonly RarityTier[],
  size: number,
  guaranteed: string | null,
  random: Random = Math.random,
): PoolCard[] {
  const out: PoolCard[] = [];
  for (let i = 0; i < size; i++) {
    const last = i === size - 1;
    const card = drawOne(pool, tiers, random, last ? guaranteed : null);
    if (card) out.push(card);
  }
  return out;
}

export function rarityByActivity(
  ranked: readonly { cardId: string; messages: number }[],
  tiers: readonly RarityTier[],
): Map<string, string> {
  const out = new Map<string, string>();
  const common = tiers[0];
  if (!common) return out;
  const total = tiers.reduce((sum, tier) => sum + tier.weight, 0);
  const sorted = [...ranked].sort((a, b) => b.messages - a.messages);
  const count = sorted.length;
  sorted.forEach((row, index) => {
    if (row.messages <= 0 || total <= 0) {
      out.set(row.cardId, common.id);
      return;
    }
    const position = index / count;
    let reach = 0;
    let chosen = common.id;
    for (let t = tiers.length - 1; t >= 0; t--) {
      const tier = tiers[t] as RarityTier;
      reach += tier.weight / total;
      if (position < reach) {
        chosen = tier.id;
        break;
      }
    }
    out.set(row.cardId, chosen);
  });
  return out;
}

export function parseCardRefs(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((part) => /^#?(\d{1,10})$/.exec(part)?.[1])
    .filter((ref): ref is string => ref !== undefined)
    .map((ref) => String(Number(ref)));
}

export function splitTrade(text: string): { give: string[]; want: string[] } | null {
  const parts = text.split(/\b(?:for|gegen)\b/i);
  if (parts.length > 2) return null;
  const give = parseCardRefs(parts[0] ?? '');
  const want = parseCardRefs(parts[1] ?? '');
  const tokens = text.split(/[\s,]+/).filter((part) => part && !/^(?:for|gegen)$/i.test(part));
  if (tokens.length !== give.length + want.length) return null;
  return { give, want };
}

export function setCards(
  set: CardSet,
  deckCards: ReadonlyMap<string, readonly string[]>,
): string[] {
  const ids = new Set(set.cardIds);
  if (set.deckId) for (const id of deckCards.get(set.deckId) ?? []) ids.add(id);
  return [...ids];
}

export function setProgress(cards: readonly string[], owned: ReadonlySet<string>): number {
  return cards.filter((id) => owned.has(id)).length;
}
