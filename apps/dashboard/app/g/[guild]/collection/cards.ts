import type { DeckCard } from '@maxwell/core/stores/collection';

export interface CardView {
  id: string;
  number: number;
  deck: string;
  name: string;
  description: string;
  rarity: string;
  image: string | null;
  active: boolean;
  owners: number;
}

export function cardView(card: DeckCard): CardView {
  return {
    id: card.id,
    number: card.number,
    deck: card.deck,
    name: card.name,
    description: card.description,
    rarity: card.rarity,
    image: card.assetKey,
    active: card.active,
    owners: card.owners,
  };
}
