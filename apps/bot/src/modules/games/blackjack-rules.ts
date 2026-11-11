import type { BlackjackHand } from '@maxwell/core/stores/games';

export type Random = () => number;
export type Action = 'hit' | 'stand' | 'double' | 'split';
export type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];
const SUIT_SIGNS: Record<string, string> = {
  S: String.fromCodePoint(0x2660),
  H: String.fromCodePoint(0x2665),
  D: String.fromCodePoint(0x2666),
  C: String.fromCodePoint(0x2663),
};

export function shoe(decks: number, random: Random = Math.random): string[] {
  const cards: string[] = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) for (const rank of RANKS) cards.push(`${rank}${suit}`);
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j] as string, cards[i] as string];
  }
  return cards;
}

function rankValue(card: string): number {
  const rank = card[0] ?? '';
  if (rank === 'A') return 11;
  if ('TJQK'.includes(rank)) return 10;
  return Number(rank);
}

export function total(cards: readonly string[]): { value: number; soft: boolean } {
  let value = 0;
  let aces = 0;
  for (const card of cards) {
    value += rankValue(card);
    if (card[0] === 'A') aces += 1;
  }
  while (value > 21 && aces > 0) {
    value -= 10;
    aces -= 1;
  }
  return { value, soft: aces > 0 };
}

export function natural(hand: Pick<BlackjackHand, 'cards' | 'split'>): boolean {
  return !hand.split && hand.cards.length === 2 && total(hand.cards).value === 21;
}

export function face(card: string): string {
  const rank = card[0] === 'T' ? '10' : (card[0] ?? '?');
  return `${rank}${SUIT_SIGNS[card[1] ?? ''] ?? ''}`;
}

export function draw(deck: string[], decks: number, random: Random = Math.random): string {
  if (deck.length === 0) deck.push(...shoe(decks, random));
  return deck.pop() as string;
}

export function canDouble(hand: BlackjackHand): boolean {
  return !hand.done && hand.cards.length === 2;
}

export function canSplit(hands: readonly BlackjackHand[], hand: BlackjackHand): boolean {
  const [a, b] = hand.cards;
  return (
    hands.length === 1 &&
    !hand.done &&
    hand.cards.length === 2 &&
    rankValue(a ?? '') === rankValue(b ?? '')
  );
}

export function dealerShouldPeek(dealer: readonly string[]): boolean {
  return rankValue(dealer[0] ?? '') >= 10;
}

export function playDealer(dealer: string[], deck: string[], decks: number, random?: Random): void {
  while (total(dealer).value < 17) dealer.push(draw(deck, decks, random));
}

export function outcome(hand: BlackjackHand, dealer: readonly string[]): Outcome {
  const player = total(hand.cards).value;
  if (player > 21) return 'bust';
  const house = total(dealer).value;
  const houseNatural = natural({ cards: [...dealer], split: false });
  if (natural(hand)) return houseNatural ? 'push' : 'blackjack';
  if (houseNatural) return 'lose';
  if (house > 21 || player > house) return 'win';
  return player === house ? 'push' : 'lose';
}

export function payout(hand: BlackjackHand, result: Outcome): number {
  if (result === 'blackjack') return hand.stake + Math.floor(hand.stake * 1.5);
  if (result === 'win') return hand.stake * 2;
  if (result === 'push') return hand.stake;
  return 0;
}

export function parseAction(content: string): Action | null {
  const text = content.trim().toLowerCase();
  if (['hit', 'card', 'karte', 'ziehen', 'pedir', 'carta'].includes(text)) return 'hit';
  if (
    ['stand', 'stay', 'halten', 'bleiben', 'stehen', 'plantarse', 'plantar', 'quedarse'].includes(
      text,
    )
  )
    return 'stand';
  if (['double', 'dd', 'verdoppeln', 'doblar'].includes(text)) return 'double';
  if (['split', 'teilen', 'splitten', 'dividir', 'separar'].includes(text)) return 'split';
  return null;
}
