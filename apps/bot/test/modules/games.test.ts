import { gamesConfig, triviaQuestion } from '@maxwell/core/modules/games';
import { firstLetter, lastLetter } from '@maxwell/core/stores/games';
import { describe, expect, it } from 'vitest';
import { Serial } from '../../src/modules/games/channels.js';
import {
  flip,
  hiloFactor,
  inChannels,
  isCorrect,
  nextMultiplier,
  nextNumber,
  normalize,
  parseCount,
  parseGuess,
  parseStake,
  parseWord,
  payout,
  pickQuestion,
  winChance,
} from '../../src/modules/games/logic.js';

describe('games config', () => {
  it('parses an empty config with defaults', () => {
    const config = gamesConfig.parse({});
    expect(config.trivia.questions).toEqual([]);
    expect(config.counting.channelId).toBeNull();
    expect(config.stakes.min).toBeLessThan(config.stakes.max);
  });
});

describe('trivia', () => {
  const question = triviaQuestion.parse({
    question: 'Who thought up the sorting demon?',
    answers: ['James Clerk Maxwell', 'Maxwell'],
    choices: ['Newton', 'Maxwell', 'Faraday'],
  });

  it('normalizes case, accents and punctuation', () => {
    expect(normalize('  Ångström!! ')).toBe('angstrom');
  });

  it('accepts answers and choice letters', () => {
    expect(isCorrect(question, 'maxwell')).toBe(true);
    expect(isCorrect(question, 'James  Clerk Maxwell.')).toBe(true);
    expect(isCorrect(question, 'b')).toBe(true);
    expect(isCorrect(question, 'a')).toBe(false);
    expect(isCorrect(question, 'g')).toBe(false);
    expect(isCorrect(question, '')).toBe(false);
  });

  it('never repeats the last question', () => {
    const questions = [question, question, question];
    for (const roll of [0, 0.4, 0.99]) {
      expect(pickQuestion(questions, 0, () => roll)).not.toBe(0);
    }
    expect(pickQuestion([], null)).toBeNull();
    expect(pickQuestion([question], 0)).toBe(0);
  });
});

describe('channel games', () => {
  it('reads a leading number', () => {
    expect(parseCount('42')).toBe(42);
    expect(parseCount(' 7 nice')).toBe(7);
    expect(parseCount('hello 3')).toBeNull();
    expect(parseCount('12345678901')).toBeNull();
  });

  it('reads single words only', () => {
    expect(parseWord('Apple')).toBe('apple');
    expect(parseWord("rock'n")).toBe("rock'n");
    expect(parseWord('two words')).toBeNull();
    expect(parseWord('abc1')).toBeNull();
  });

  it('finds first and last letters', () => {
    expect(lastLetter('Giraffe!')).toBe('e');
    expect(firstLetter("'Ello")).toBe('e');
  });

  it('runs tasks per key in order', async () => {
    const serial = new Serial();
    const seen: number[] = [];
    const slow = serial.run('a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      seen.push(1);
    });
    const fast = serial.run('a', async () => {
      seen.push(2);
    });
    await Promise.all([slow, fast]);
    expect(seen).toEqual([1, 2]);
    expect(serial.size).toBe(0);
  });

  it('keeps going after a failed task', async () => {
    const serial = new Serial();
    const failing = serial.run('b', async () => {
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');
    let ran = false;
    await serial.run('b', async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});

describe('higher or lower', () => {
  it('parses guesses', () => {
    expect(parseGuess('H')).toBe('higher');
    expect(parseGuess('lower')).toBe('lower');
    expect(parseGuess('cash out')).toBe('stop');
    expect(parseGuess('maybe')).toBeNull();
  });

  it('never draws the current number', () => {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.9999]) {
      const next = nextNumber(50, 100, () => roll);
      expect(next).not.toBe(50);
      expect(next).toBeGreaterThanOrEqual(1);
      expect(next).toBeLessThanOrEqual(100);
    }
  });

  it('prices guesses by their odds', () => {
    expect(winChance(50, 'higher', 100)).toBeCloseTo(50 / 99);
    expect(winChance(100, 'higher', 100)).toBe(0);
    expect(hiloFactor(100, 'higher', 100, 0.05)).toBe(0);
    expect(hiloFactor(2, 'higher', 100, 0)).toBeCloseTo(99 / 98);
    expect(nextMultiplier(1, 50, 'higher', 100, 0.05, 10)).toBeCloseTo(1.88, 2);
    expect(nextMultiplier(9, 90, 'higher', 100, 0.05, 10)).toBe(10);
    expect(payout(100, 1.88)).toBe(188);
  });

  it('flips both sides and filters channels', () => {
    expect(flip(() => 0.1)).toBe('heads');
    expect(flip(() => 0.9)).toBe('tails');
    expect(inChannels([], '1')).toBe(true);
    expect(inChannels(['2'], '1')).toBe(false);
  });
});

describe('stake words', () => {
  it('reads amounts, shares and all-in in three languages', () => {
    expect(parseStake('100')).toEqual({ kind: 'amount', value: 100 });
    expect(parseStake('1k')).toEqual({ kind: 'amount', value: 1000 });
    expect(parseStake('2.5k')).toEqual({ kind: 'amount', value: 2500 });
    expect(parseStake('1,000')).toEqual({ kind: 'amount', value: 1000 });
    expect(parseStake('1.000')).toEqual({ kind: 'amount', value: 1000 });
    expect(parseStake('all in')).toEqual({ kind: 'share', part: 1 });
    expect(parseStake('ALL')).toEqual({ kind: 'share', part: 1 });
    expect(parseStake('alles')).toEqual({ kind: 'share', part: 1 });
    expect(parseStake('todo')).toEqual({ kind: 'share', part: 1 });
    expect(parseStake('mitad')).toEqual({ kind: 'share', part: 0.5 });
    expect(parseStake('25%')).toEqual({ kind: 'share', part: 0.25 });
    expect(parseStake('0')).toBeNull();
    expect(parseStake('150%')).toBeNull();
    expect(parseStake('lots')).toBeNull();
  });
});
