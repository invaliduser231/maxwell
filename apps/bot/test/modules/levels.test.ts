import {
  levelFromXp,
  levelsConfig,
  MAX_LEVEL,
  parseCurve,
  totalXpForLevel,
  xpForNext,
} from '@maxwell/core/modules/levels';
import { describe, expect, it } from 'vitest';
import { parseImport, parseMode } from '../../src/modules/levels/importer.js';
import {
  CooldownMap,
  earns,
  multiplier,
  newRewards,
  planRewards,
  renderTemplate,
  rollXp,
} from '../../src/modules/levels/xp.js';

const base = levelsConfig.parse({});

describe('level curve', () => {
  it('uses the standard curve by default', () => {
    expect(xpForNext(0)).toBe(100);
    expect(xpForNext(1)).toBe(155);
    expect(xpForNext(10)).toBe(1_100);
    expect(totalXpForLevel(1)).toBe(100);
    expect(totalXpForLevel(2)).toBe(255);
    expect(totalXpForLevel(5)).toBe(1_150);
  });

  it('finds the level and progress for any XP', () => {
    expect(levelFromXp(0)).toEqual({ level: 0, into: 0, needed: 100, total: 0 });
    expect(levelFromXp(99).level).toBe(0);
    expect(levelFromXp(100)).toEqual({ level: 1, into: 0, needed: 155, total: 100 });
    expect(levelFromXp(300)).toEqual({ level: 2, into: 45, needed: 220, total: 300 });
    expect(levelFromXp(-50).level).toBe(0);
  });

  it('round trips every level on every curve', () => {
    for (const curve of ['standard', 'gentle', 'linear'] as const) {
      for (const level of [0, 1, 2, 7, 50, 333, MAX_LEVEL - 1]) {
        const total = totalXpForLevel(level, curve);
        expect(levelFromXp(total, curve).level).toBe(level);
        expect(levelFromXp(total - 1, curve).level).toBe(Math.max(0, level - 1));
      }
    }
  });

  it('caps at the maximum level', () => {
    const top = levelFromXp(Number.MAX_SAFE_INTEGER);
    expect(top.level).toBe(MAX_LEVEL);
    expect(top.needed).toBe(0);
  });

  it('grows faster on steeper curves', () => {
    expect(totalXpForLevel(30, 'linear')).toBeLessThan(totalXpForLevel(30, 'gentle'));
    expect(totalXpForLevel(30, 'gentle')).toBeLessThan(totalXpForLevel(30, 'standard'));
  });

  it('falls back to the standard curve for unknown names', () => {
    expect(parseCurve('gentle')).toBe('gentle');
    expect(parseCurve('wild')).toBe('standard');
    expect(parseCurve(null)).toBe('standard');
  });
});

describe('xp rolls', () => {
  const config = levelsConfig.parse({
    channelMultipliers: [{ channelId: 'c2', multiplier: 2 }],
    roleMultipliers: [
      { roleId: 'r1', multiplier: 1.5 },
      { roleId: 'r2', multiplier: 3 },
    ],
    excludedChannels: ['c9'],
    excludedRoles: ['muted'],
  });

  it('skips excluded channels and roles', () => {
    expect(earns(config, 'c1', [])).toBe(true);
    expect(earns(config, 'c9', [])).toBe(false);
    expect(earns(config, 'c1', ['muted'])).toBe(false);
  });

  it('multiplies the channel with the best role', () => {
    expect(multiplier(config, 'c1', [])).toBe(1);
    expect(multiplier(config, 'c2', [])).toBe(2);
    expect(multiplier(config, 'c2', ['r1', 'r2'])).toBe(6);
  });

  it('rolls inside the range', () => {
    const low = rollXp(config, 'c1', [], (min) => min);
    const high = rollXp(config, 'c1', [], (_, max) => max);
    expect(low).toBe(15);
    expect(high).toBe(25);
    expect(rollXp(config, 'c2', ['r1'], (min) => min)).toBe(45);
  });

  it('copes with a swapped or fixed range', () => {
    const swapped = levelsConfig.parse({ xpMin: 30, xpMax: 10 });
    expect(rollXp(swapped, 'c', [], (min) => min)).toBe(10);
    const fixed = levelsConfig.parse({ xpMin: 20, xpMax: 20 });
    expect(rollXp(fixed, 'c', [], () => 999)).toBe(20);
  });
});

describe('rewards', () => {
  const rewards = [
    { level: 5, roleId: 'bronze' },
    { level: 10, roleId: 'silver' },
    { level: 20, roleId: 'gold' },
  ];

  it('stacks rewards by default', () => {
    expect(planRewards(rewards, 12, false, ['bronze'])).toEqual({ add: ['silver'], remove: [] });
  });

  it('keeps only the latest reward when asked', () => {
    expect(planRewards(rewards, 12, true, ['bronze'])).toEqual({
      add: ['silver'],
      remove: ['bronze'],
    });
  });

  it('only strips higher rewards in strict mode', () => {
    expect(planRewards(rewards, 6, false, ['bronze', 'gold'])).toEqual({ add: [], remove: [] });
    expect(planRewards(rewards, 6, false, ['bronze', 'gold'], true)).toEqual({
      add: [],
      remove: ['gold'],
    });
    expect(planRewards(rewards, 0, false, ['bronze'], true)).toEqual({
      add: [],
      remove: ['bronze'],
    });
  });

  it('lists rewards crossed in one jump, highest first', () => {
    expect(newRewards(rewards, 4, 10).map((r) => r.roleId)).toEqual(['silver', 'bronze']);
    expect(newRewards(rewards, 10, 11)).toEqual([]);
  });
});

describe('level-up template', () => {
  it('fills every known placeholder and leaves the rest', () => {
    const text = renderTemplate('{user} {name} {level} {role} {server} {unknown}', {
      user: '<@1>',
      name: 'Lena',
      level: 12,
      role: 'Regular',
      server: 'Example',
    });
    expect(text).toBe('<@1> Lena 12 Regular Example {unknown}');
  });

  it('renders the default message', () => {
    expect(
      renderTemplate(base.message, { user: '', name: 'Lena', level: 12, role: '', server: '' }),
    ).toBe('**Lena** is now level 12.');
  });
});

describe('cooldown map', () => {
  it('holds a key until it expires', () => {
    const map = new CooldownMap();
    expect(map.ready('a', 0)).toBe(true);
    map.hold('a', 1_000, 0);
    expect(map.ready('a', 999)).toBe(false);
    expect(map.ready('a', 1_000)).toBe(true);
  });

  it('stays bounded', () => {
    const map = new CooldownMap(100);
    for (let i = 0; i < 1_000; i++) map.hold(`k${i}`, 60_000, 0);
    expect(map.size).toBeLessThanOrEqual(100);
    expect(map.ready('k999', 1)).toBe(false);
  });
});

describe('import', () => {
  it('reads members with xp or level', () => {
    const parsed = parseImport(
      {
        members: [
          { id: '100000000000000001', xp: 5_000, level: 9 },
          { id: '100000000000000002', level: 2 },
          { id: 'nope', xp: 5 },
          { id: '100000000000000003' },
        ],
      },
      'standard',
    );
    expect(parsed).toEqual({
      entries: [
        { userId: '100000000000000001', xp: 5_000 },
        { userId: '100000000000000002', xp: 255 },
      ],
      skipped: 2,
    });
  });

  it('reads a plain JSON string and keeps the higher duplicate', () => {
    const parsed = parseImport(
      JSON.stringify([
        { user_id: '100000000000000001', xp: '40' },
        { user_id: '100000000000000001', xp: 90 },
      ]),
      'standard',
    );
    expect(parsed?.entries).toEqual([{ userId: '100000000000000001', xp: 90 }]);
  });

  it('rejects input it cannot read', () => {
    expect(parseImport('not json', 'standard')).toBeNull();
    expect(parseImport({ nothing: true }, 'standard')).toBeNull();
  });

  it('defaults to replacing', () => {
    expect(parseMode('add')).toBe('add');
    expect(parseMode('max')).toBe('max');
    expect(parseMode('whatever')).toBe('replace');
  });
});

describe('config', () => {
  it('has a default for every field', () => {
    expect(base.announce).toBe('current');
    expect(base.rewards).toEqual([]);
    expect(base.curve).toBe('standard');
  });
});
