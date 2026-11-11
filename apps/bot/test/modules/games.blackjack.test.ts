import type { BlackjackHand } from '@maxwell/core/stores/games';
import { describe, expect, it } from 'vitest';
import {
  canSplit,
  face,
  natural,
  outcome,
  parseAction,
  payout,
  playDealer,
  shoe,
  total,
} from '../../src/modules/games/blackjack-rules.js';

const hand = (cards: string[], extra: Partial<BlackjackHand> = {}): BlackjackHand => ({
  cards,
  stake: 100,
  doubled: false,
  done: true,
  split: false,
  ...extra,
});

describe('blackjack rules', () => {
  it('counts aces as 1 or 11', () => {
    expect(total(['AS', 'KH'])).toEqual({ value: 21, soft: true });
    expect(total(['AS', 'AH', '9C'])).toEqual({ value: 21, soft: true });
    expect(total(['AS', '9H', '5C'])).toEqual({ value: 15, soft: false });
    expect(total(['KS', 'QH', '2C']).value).toBe(22);
  });

  it('knows a natural only on the first two cards of an unsplit hand', () => {
    expect(natural(hand(['AS', 'TH']))).toBe(true);
    expect(natural(hand(['AS', 'TH'], { split: true }))).toBe(false);
    expect(natural(hand(['7S', '7H', '7C']))).toBe(false);
  });

  it('settles hands against the dealer', () => {
    expect(outcome(hand(['AS', 'KH']), ['9S', '7H'])).toBe('blackjack');
    expect(outcome(hand(['AS', 'KH']), ['AD', 'QC'])).toBe('push');
    expect(outcome(hand(['TS', '9H']), ['AD', 'QC'])).toBe('lose');
    expect(outcome(hand(['TS', '9H']), ['TD', '8C'])).toBe('win');
    expect(outcome(hand(['TS', '8H']), ['TD', '8C'])).toBe('push');
    expect(outcome(hand(['TS', '8H', '5D']), ['TD', '6C', 'KC'])).toBe('bust');
    expect(outcome(hand(['TS', '2H']), ['TD', '6C', 'KC'])).toBe('win');
  });

  it('pays 3 to 2 for blackjack and even money for a win', () => {
    expect(payout(hand([]), 'blackjack')).toBe(250);
    expect(payout(hand([]), 'win')).toBe(200);
    expect(payout(hand([]), 'push')).toBe(100);
    expect(payout(hand([]), 'lose')).toBe(0);
    expect(payout(hand([], { stake: 0 }), 'win')).toBe(0);
  });

  it('lets the dealer draw to 17 and stand on soft 17', () => {
    const dealer = ['TS', '6H'];
    const deck = ['9C', 'KD', '2S'];
    playDealer(dealer, deck, 1);
    expect(dealer).toEqual(['TS', '6H', '2S']);
    const soft = ['AS', '6H'];
    playDealer(soft, ['5C'], 1);
    expect(soft).toEqual(['AS', '6H']);
  });

  it('allows one split of a pair, including ten-value cards', () => {
    expect(
      canSplit([hand(['8S', '8H'], { done: false })], hand(['8S', '8H'], { done: false })),
    ).toBe(true);
    const tens = hand(['KS', 'TH'], { done: false });
    expect(canSplit([tens], tens)).toBe(true);
    expect(canSplit([tens, tens], tens)).toBe(false);
    const mixed = hand(['8S', '9H'], { done: false });
    expect(canSplit([mixed], mixed)).toBe(false);
  });

  it('builds a full shuffled shoe and shows cards with suits', () => {
    const cards = shoe(2, () => 0.5);
    expect(cards).toHaveLength(104);
    expect(new Set(cards).size).toBe(52);
    expect(face('TH')).toBe(`10${String.fromCodePoint(0x2665)}`);
    expect(face('AS')).toBe(`A${String.fromCodePoint(0x2660)}`);
  });

  it('reads typed moves in three languages', () => {
    expect(parseAction('Hit')).toBe('hit');
    expect(parseAction('karte')).toBe('hit');
    expect(parseAction('plantarse')).toBe('stand');
    expect(parseAction('verdoppeln')).toBe('double');
    expect(parseAction('dividir')).toBe('split');
    expect(parseAction('h')).toBeNull();
    expect(parseAction('hello')).toBeNull();
  });
});
