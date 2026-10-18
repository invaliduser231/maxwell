import { giveawaysConfig } from '@maxwell/core/modules/giveaways';
import type { Giveaway } from '@maxwell/core/stores/giveaways';
import { describe, expect, it } from 'vitest';
import {
  claimShopEntries,
  collectReactors,
  displayEmoji,
  type EntryWallet,
  entryWeight,
  MAX_WEIGHT,
  pickWinners,
  reactionForm,
  sameEmoji,
  unmet,
  weightedOrder,
} from '../../src/modules/giveaways/draw.js';
import { parseStartOptions } from '../../src/modules/giveaways/options.js';
import { endedEmbed, runningEmbed } from '../../src/modules/giveaways/render.js';
import { GiveawayRunner, giveawaySpec, resolveTimes } from '../../src/modules/giveaways/runner.js';

const DAY = 24 * 60 * 60 * 1000;

function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0.5;
}

describe('entries', () => {
  const bonus = [
    { roleId: 'booster', entries: 2 },
    { roleId: 'regular', entries: 1 },
  ];

  it('adds bonus entries for every matching role', () => {
    expect(entryWeight(bonus, [])).toBe(1);
    expect(entryWeight(bonus, ['booster'])).toBe(3);
    expect(entryWeight(bonus, ['booster', 'regular', 'other'])).toBe(4);
  });

  it('caps the weight', () => {
    expect(
      entryWeight(
        [
          { roleId: 'a', entries: 50 },
          { roleId: 'b', entries: 50 },
        ],
        ['a', 'b'],
      ),
    ).toBe(MAX_WEIGHT);
  });
});

describe('requirements', () => {
  const now = Date.UTC(2026, 9, 21);
  const open = { requiredRoleId: null, minLevel: 0, minMemberDays: 0 };

  it('lets anyone in without requirements', () => {
    expect(unmet(open, { roles: [], joinedAt: null }, null, now)).toBeNull();
  });

  it('checks the role first, then level, then membership age', () => {
    const strict = { requiredRoleId: 'vip', minLevel: 5, minMemberDays: 7 };
    const fresh = new Date(now - DAY);
    const old = new Date(now - 30 * DAY);
    expect(unmet(strict, { roles: [], joinedAt: old }, 10, now)).toBe('role');
    expect(unmet(strict, { roles: ['vip'], joinedAt: old }, 4, now)).toBe('level');
    expect(unmet(strict, { roles: ['vip'], joinedAt: fresh }, 5, now)).toBe('age');
    expect(unmet(strict, { roles: ['vip'], joinedAt: null }, 5, now)).toBe('age');
    expect(unmet(strict, { roles: ['vip'], joinedAt: old }, 5, now)).toBeNull();
  });

  it('turns away members with the excluded role before anything else', () => {
    const rules = { ...open, requiredRoleId: 'vip', excludedRoleId: 'muted' };
    expect(unmet(rules, { roles: ['vip', 'muted'], joinedAt: null }, null, now)).toBe('excluded');
    expect(unmet(rules, { roles: ['vip'], joinedAt: null }, null, now)).toBeNull();
  });
});

describe('start options', () => {
  it('splits flags from the prize', () => {
    expect(
      parseStartOptions(
        'Steam key  for Hades --role <@&400000000000000002> --not 400000000000000003 --level 5 --days 30 --ping <@&400000000000000004> --nodm',
      ),
    ).toEqual({
      ok: true,
      prize: 'Steam key for Hades',
      options: {
        requiredRoleId: '400000000000000002',
        excludedRoleId: '400000000000000003',
        pingRoleId: '400000000000000004',
        minLevel: 5,
        minMemberDays: 30,
        dmWinners: false,
      },
    });
  });

  it('keeps plain prizes as they are', () => {
    expect(parseStartOptions('Art commission')).toEqual({
      ok: true,
      prize: 'Art commission',
      options: {},
    });
  });

  it('rejects unknown flags and missing values', () => {
    expect(parseStartOptions('Key --colour red')).toEqual({ ok: false, flag: 'colour' });
    expect(parseStartOptions('Key --role')).toEqual({ ok: false, flag: 'role' });
    expect(parseStartOptions('Key --level many')).toEqual({ ok: false, flag: 'level' });
  });
});

describe('draw', () => {
  it('orders by weighted keys and skips empty weights', () => {
    const order = weightedOrder(
      [
        { userId: 'a', weight: 1 },
        { userId: 'b', weight: 0 },
        { userId: 'c', weight: 1 },
      ],
      sequence(0.2, 0.9),
    );
    expect(order).toEqual(['c', 'a']);
  });

  it('favours heavier entries over many draws', () => {
    const wins = { light: 0, heavy: 0 };
    for (let i = 0; i < 4_000; i++) {
      const [first] = weightedOrder([
        { userId: 'light', weight: 1 },
        { userId: 'heavy', weight: 3 },
      ]);
      wins[first as keyof typeof wins]++;
    }
    expect(wins.heavy / 4_000).toBeGreaterThan(0.68);
    expect(wins.heavy / 4_000).toBeLessThan(0.82);
  });

  it('picks distinct winners and skips excluded or absent members', async () => {
    const entries = ['a', 'b', 'c', 'd'].map((userId) => ({ userId, weight: 1 }));
    const winners = await pickWinners(
      entries,
      2,
      new Set(['a']),
      async (userId) => userId !== 'b',
      sequence(0.9, 0.8, 0.7, 0.6),
    );
    expect(winners).toEqual(['c', 'd']);
  });

  it('returns fewer winners when the pool runs dry', async () => {
    const winners = await pickWinners([{ userId: 'a', weight: 1 }], 3, new Set(), async () => true);
    expect(winners).toEqual(['a']);
  });
});

describe('emoji', () => {
  it('compares unicode and custom emoji forms', () => {
    expect(reactionForm('<:party:123>')).toBe('party:123');
    expect(sameEmoji('<a:party:123>', 'party:123')).toBe(true);
    expect(sameEmoji('❤️', '❤')).toBe(true);
    expect(sameEmoji('party:123', 'party:124')).toBe(false);
    expect(displayEmoji('party:123')).toBe('<:party:123>');
  });
});

describe('times', () => {
  const now = Date.UTC(2026, 9, 21, 12);

  it('starts now unless a later start is given', () => {
    expect(resolveTimes({ durationSeconds: 3_600 }, now)).toEqual({
      startsAt: new Date(now),
      endsAt: new Date(now + 3_600_000),
    });
    const later = new Date(now + DAY);
    expect(resolveTimes({ startsAt: later, durationSeconds: 600 }, now)?.endsAt).toEqual(
      new Date(later.getTime() + 600_000),
    );
  });

  it('rejects giveaways that are too short, too long or have no end', () => {
    expect(resolveTimes({ endsAt: new Date(now + 10_000) }, now)).toBeNull();
    expect(resolveTimes({ endsAt: new Date(now + 61 * DAY) }, now)).toBeNull();
    expect(resolveTimes({}, now)).toBeNull();
  });

  it('parses a dashboard spec', () => {
    const spec = giveawaySpec.parse({
      channelId: '400000000000000001',
      prize: '  Art commission ',
      endsAt: '2026-10-28T12:00:00Z',
      bonus: [{ roleId: '400000000000000002', entries: 2 }],
    });
    expect(spec.prize).toBe('Art commission');
    expect(spec.winners).toBe(1);
    expect(spec.endsAt).toEqual(new Date('2026-10-28T12:00:00Z'));
    expect(giveawaySpec.safeParse({ channelId: 'x', prize: 'a' }).success).toBe(false);
  });
});

describe('embeds', () => {
  const giveaway: Giveaway = {
    id: '4821',
    number: 12,
    guildId: '1',
    channelId: '2',
    messageId: '3',
    hostId: '400000000000000009',
    prize: 'Steam key',
    winners: 2,
    emoji: 'party:123',
    status: 'running',
    startsAt: new Date(0),
    endsAt: new Date(DAY),
    endedAt: null,
    requiredRoleId: '400000000000000002',
    minLevel: 5,
    minMemberDays: 7,
    bonus: [{ roleId: '400000000000000003', entries: 2 }],
    createdAt: new Date(0),
    description: null,
    excludedRoleId: null,
    pingRoleId: null,
    dmWinners: true,
  };

  it('shows the description and the excluded role', () => {
    const embed = runningEmbed({
      ...giveaway,
      description: 'Key for the deluxe edition.',
      excludedRoleId: '400000000000000004',
    });
    expect(embed.description?.startsWith('Key for the deluxe edition.\n\nReact with')).toBe(true);
    expect(embed.description).toContain('**Not for** <@&400000000000000004>');
  });

  it('lists requirements and bonus entries while running', () => {
    const embed = runningEmbed(giveaway);
    expect(embed.title).toBe('Steam key');
    expect(embed.description).toContain('React with <:party:123> to enter.');
    expect(embed.description).toContain(
      '**Needs** <@&400000000000000002>, level 5, 7 days in the community',
    );
    expect(embed.description).toContain('**Bonus entries** <@&400000000000000003> +2');
    expect(embed.footer).toBe('Giveaway 12');
  });

  it('shows winners and rerolls once ended', () => {
    const embed = endedEmbed(
      { ...giveaway, status: 'ended', endedAt: new Date(DAY) },
      [
        { userId: '5', round: 1, drawnAt: new Date() },
        { userId: '6', round: 2, drawnAt: new Date() },
      ],
      9,
    );
    expect(embed.description).toContain('**Winners** <@5>');
    expect(embed.description).toContain('**Rerolled** <@6>');
    expect(embed.description).toContain('**Entries** 9');
  });
});

describe('config', () => {
  it('has a default for every field', () => {
    const config = giveawaysConfig.parse({});
    expect(config.emoji).toBeNull();
    expect(config.dmWinners).toBe(true);
    expect(config.bonusEntries).toEqual([]);
  });
});

describe('reaction paging', () => {
  it('follows the after cursor until a short page', async () => {
    const all = Array.from({ length: 7 }, (_, i) => String(100 + i));
    const cursors: (string | undefined)[] = [];
    const result = await collectReactors(async (after) => {
      cursors.push(after);
      const start = after ? all.indexOf(after) + 1 : 0;
      return all.slice(start, start + 3);
    }, 3);
    expect(result).toEqual({ users: all, complete: true });
    expect(cursors).toEqual([undefined, '102', '105']);
  });

  it('stops on an exact multiple with an empty page', async () => {
    const pages = [['1', '2'], ['3', '4'], []];
    let i = 0;
    const result = await collectReactors(async () => pages[i++] ?? [], 2);
    expect(result).toEqual({ users: ['1', '2', '3', '4'], complete: true });
  });

  it('keeps what it read when a page fails or the cursor sticks', async () => {
    let calls = 0;
    const failed = await collectReactors(async () => {
      calls++;
      if (calls > 1) throw new Error('rate limited');
      return ['1', '2'];
    }, 2);
    expect(failed).toEqual({ users: ['1', '2'], complete: false });

    const stuck = await collectReactors(async () => ['1', '2'], 2, 10);
    expect(stuck.complete).toBe(false);
    expect(stuck.users).toEqual(['1', '2', '1', '2']);

    const capped = await collectReactors(async (after) => [String(Number(after ?? 0) + 1)], 1, 3);
    expect(capped).toEqual({ users: ['1', '2', '3'], complete: false });
  });
});

describe('shop entries', () => {
  function wallet(held: Record<string, { own?: number; any?: number }>) {
    const taken: string[] = [];
    const fake: EntryWallet = {
      async giveawayEntries(_guildId, userId) {
        const h = held[userId];
        return (h?.own ?? 0) + (h?.any ?? 0);
      },
      async takeItem(_guildId, userId, kind, ref) {
        const h = held[userId];
        if (!h || kind !== 'giveaway') return false;
        const slot = ref === null ? 'any' : 'own';
        if ((h[slot] ?? 0) <= 0) return false;
        h[slot] = (h[slot] ?? 0) - 1;
        taken.push(`${userId}:${slot}`);
        return true;
      },
    };
    return { fake, taken, held };
  }

  it('adds held entries to entrants and uses giveaway-specific ones first', async () => {
    const { fake, taken, held } = wallet({ a: { own: 1, any: 2 }, c: { any: 1 } });
    const weights = await claimShopEntries(fake, '1', '12', [
      { userId: 'a', weight: 2 },
      { userId: 'b', weight: 1 },
    ]);
    expect(weights).toEqual(new Map([['a', 5]]));
    expect(taken).toEqual(['a:own', 'a:any', 'a:any']);
    expect(held.c?.any).toBe(1);
  });

  it('only uses what fits under the cap', async () => {
    const { fake, held } = wallet({ a: { any: 5 }, b: { any: 3 } });
    const weights = await claimShopEntries(fake, '1', '12', [
      { userId: 'a', weight: MAX_WEIGHT - 2 },
      { userId: 'b', weight: MAX_WEIGHT },
    ]);
    expect(weights).toEqual(new Map([['a', MAX_WEIGHT]]));
    expect(held.a?.any).toBe(3);
    expect(held.b?.any).toBe(3);
  });
});

describe('runner reactions', () => {
  it('never looks up bot reactions', async () => {
    const touched: string[] = [];
    const trap = new Proxy(
      {},
      {
        get: (_target, key) => () => {
          touched.push(String(key));
          throw new Error('should not be called');
        },
      },
    );
    const ctx = { services: { platform: { selfId: '900' } } };
    const runner = new GiveawayRunner(ctx as never, trap as never, trap as never);
    const reaction = {
      guildId: '1',
      channelId: '2',
      messageId: '3',
      userId: '44',
      emoji: 'party:123',
      bot: true,
    };
    await runner.onReaction(reaction);
    await runner.onReactionRemove(reaction);
    expect(touched).toEqual([]);
  });
});
