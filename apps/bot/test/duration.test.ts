import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration } from '../src/commands/duration.js';

describe('parseDuration', () => {
  it.each([
    ['30s', 30_000],
    ['5m', 300_000],
    ['2h', 7_200_000],
    ['1d12h', 129_600_000],
    ['1W', 604_800_000],
  ])('%s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', '10', 'h', '5x', '5m junk', '0s'])('rejects %j', (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('keeps the two largest units', () => {
    expect(formatDuration(3_000)).toBe('3s');
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(93_784_000)).toBe('1d 2h');
  });
});
