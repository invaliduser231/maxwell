import { describe, expect, it } from 'vitest';
import { liveTables, parseLive } from '../src/live/live.js';

describe('live', () => {
  it('parses guild and module from a payload', () => {
    expect(parseLive('123:tickets')).toEqual({ guildId: '123', module: 'tickets' });
    expect(parseLive('abc:tickets')).toBeNull();
    expect(parseLive('123:')).toBeNull();
    expect(parseLive('tickets')).toBeNull();
  });

  it('lists every table once', () => {
    const names = liveTables.map((entry) => entry.table);
    expect(new Set(names).size).toBe(names.length);
  });
});
