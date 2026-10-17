import { describe, expect, it } from 'vitest';
import { Cooldowns } from '../src/commands/cooldowns.js';

describe('Cooldowns', () => {
  it('blocks until the window has passed', () => {
    let now = 1_000;
    const cooldowns = new Cooldowns(() => now);
    expect(cooldowns.take('ping:1', 3_000)).toBe(0);
    now += 1_000;
    expect(cooldowns.take('ping:1', 3_000)).toBe(2_000);
    expect(cooldowns.take('ping:2', 3_000)).toBe(0);
    now += 2_000;
    expect(cooldowns.take('ping:1', 3_000)).toBe(0);
  });
});
