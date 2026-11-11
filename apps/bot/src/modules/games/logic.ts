import type { TriviaQuestion } from '@maxwell/core/modules/games';
import { evaluateCount } from './math.js';

export type Random = () => number;

export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export function isCorrect(question: TriviaQuestion, input: string): boolean {
  const answers = question.answers.map(normalize);
  const given = normalize(input);
  if (!given) return false;
  if (answers.includes(given)) return true;
  if (question.choices.length > 0 && /^[a-f]$/.test(given)) {
    const choice = question.choices[given.charCodeAt(0) - 97];
    return choice !== undefined && answers.includes(normalize(choice));
  }
  return false;
}

export function pickQuestion(
  questions: readonly TriviaQuestion[],
  last: number | null,
  random: Random = Math.random,
): number | null {
  if (questions.length === 0) return null;
  if (questions.length === 1) return 0;
  let index = Math.floor(random() * (questions.length - 1));
  if (last !== null && index >= last) index += 1;
  return Math.min(index, questions.length - 1);
}

export function parseCount(content: string): number | null {
  return evaluateCount(content);
}

export function parseWord(content: string): string | null {
  const text = content.trim();
  if (!/^[\p{L}][\p{L}'-]*$/u.test(text) || text.length > 64) return null;
  return text.toLowerCase();
}

export type Guess = 'higher' | 'lower' | 'stop';

export function parseGuess(content: string): Guess | null {
  const text = content.trim().toLowerCase();
  if (['h', 'hi', 'higher', 'up', '+', 'höher', 'hoeher', 'hoch'].includes(text)) return 'higher';
  if (['l', 'lo', 'lower', 'down', '-', 't', 'tiefer', 'runter', 'niedriger'].includes(text))
    return 'lower';
  if (['stop', 'cash', 'cashout', 'cash out', 'done', 'stopp', 'fertig'].includes(text))
    return 'stop';
  return null;
}

export function nextNumber(current: number, max: number, random: Random = Math.random): number {
  const pick = 1 + Math.floor(random() * (max - 1));
  return pick >= current ? pick + 1 : pick;
}

export function winChance(current: number, guess: 'higher' | 'lower', max: number): number {
  const favorable = guess === 'higher' ? max - current : current - 1;
  return Math.max(favorable, 0) / (max - 1);
}

export function hiloFactor(
  current: number,
  guess: 'higher' | 'lower',
  max: number,
  edge: number,
): number {
  const chance = winChance(current, guess, max);
  return chance > 0 ? (1 - edge) / chance : 0;
}

export function nextMultiplier(
  multiplier: number,
  current: number,
  guess: 'higher' | 'lower',
  max: number,
  edge: number,
  cap: number,
): number {
  return Math.min(Math.round(multiplier * hiloFactor(current, guess, max, edge) * 100) / 100, cap);
}

export function payout(stake: number, multiplier: number): number {
  return Math.floor(stake * multiplier);
}

export function flip(random: Random = Math.random): 'heads' | 'tails' {
  return random() < 0.5 ? 'heads' : 'tails';
}

export function inChannels(channelIds: readonly string[], channelId: string): boolean {
  return channelIds.length === 0 || channelIds.includes(channelId);
}
