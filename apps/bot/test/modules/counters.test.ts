import {
  type Counter,
  type CountersConfig,
  type CounterValues,
  counterName,
  daysUntil,
} from '@maxwell/core/modules/counters';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';
import { CounterBoard, RENAME_GAP, todayIn } from '../../src/modules/counters/board.js';
import { counterInput } from '../../src/modules/counters/commands.js';
import { changedGuild } from '../../src/modules/counters/index.js';
import type { ChannelRef, RoleRef } from '../../src/platform/types.js';

const guild = '900000000000000040';

const values: CounterValues = {
  members: 1234,
  online: 87,
  voice: 3,
  channels: 12,
  roles: 7,
  today: '2026-11-02',
};

function item(patch: Partial<Counter>): Counter {
  return {
    channelId: '510000000000000001',
    type: 'members',
    template: 'Members: {count}',
    goal: null,
    until: null,
    ...patch,
  };
}

describe('counter names', () => {
  it('fills in the count in the language of the community', () => {
    expect(counterName(item({}), values)).toBe('Members: 1,234');
    expect(counterName(item({}), values, 'de-DE')).toBe('Members: 1.234');
    expect(counterName(item({ type: 'online', template: 'Online {count}' }), values)).toBe(
      'Online 87',
    );
  });

  it('shows progress towards a goal', () => {
    const goal = item({ type: 'goal', goal: 2000, template: '{count} / {goal}, {left} to go' });
    expect(counterName(goal, values)).toBe('1,234 / 2,000, 766 to go');
    expect(counterName({ ...goal, goal: 1000 }, values)).toBe('1,234 / 1,000, 0 to go');
  });

  it('counts down whole days and stops at zero', () => {
    expect(daysUntil('2026-11-12', '2026-11-02')).toBe(10);
    expect(daysUntil('2026-11-01', '2026-11-02')).toBe(0);
    const countdown = item({ type: 'countdown', until: '2026-12-24', template: '{count} days' });
    expect(counterName(countdown, values)).toBe('52 days');
    expect(counterName({ ...countdown, until: null }, values)).toBeNull();
  });

  it('skips counts the platform did not send yet', () => {
    expect(counterName(item({ type: 'online' }), { ...values, online: null })).toBeNull();
  });

  it('keeps names within the channel limit', () => {
    expect(counterName(item({ template: `${'x'.repeat(98)} {count}` }), values)).toHaveLength(100);
  });

  it('reads today in the community timezone', () => {
    const late = new Date('2026-11-02T23:30:00Z');
    expect(todayIn('UTC', late)).toBe('2026-11-02');
    expect(todayIn('Europe/Berlin', late)).toBe('2026-11-03');
    expect(todayIn('Not/AZone', late)).toBe('2026-11-02');
  });
});

describe('counter command input', () => {
  it('needs a number for goals and a date for countdowns', () => {
    expect(counterInput('members', undefined)).toEqual({
      type: 'members',
      goal: null,
      until: null,
    });
    expect(counterInput('goal', '500')).toEqual({ type: 'goal', goal: 500, until: null });
    expect(counterInput('goal', 'lots')).toBe('goal');
    expect(counterInput('goal', undefined)).toBe('goal');
    expect(counterInput('countdown', '2027-01-01')).toEqual({
      type: 'countdown',
      goal: null,
      until: '2027-01-01',
    });
    expect(counterInput('countdown', 'soon')).toBe('date');
  });
});

describe('config changes', () => {
  it('only reacts to the counters module', () => {
    expect(changedGuild(`${guild}:counters`)).toBe(guild);
    expect(changedGuild(`${guild}:welcome`)).toBeNull();
    expect(changedGuild('x:counters')).toBeNull();
  });
});

describe('counter board', () => {
  let config: CountersConfig;
  let enabled: boolean;
  let channels: ChannelRef[];
  let renames: { channelId: string; name: string }[];
  let requested: string[][];
  let updates: { patch: Partial<CountersConfig>; actor: { id: string | null } }[];
  let board: CounterBoard;
  let counts: { members: number | null; online: number | null } | null;

  const channel = (id: string, name: string, type = 2): ChannelRef => ({
    id,
    guildId: guild,
    name,
    type,
    parentId: null,
    position: 0,
    topic: null,
    nsfw: false,
    userLimit: null,
    rateLimitPerUser: 0,
    overwrites: [],
  });

  const role = (id: string): RoleRef => ({
    id,
    name: id,
    color: 0,
    position: 0,
    permissions: '0',
    managed: false,
    hoist: false,
    mentionable: false,
  });

  beforeEach(() => {
    enabled = true;
    counts = { members: 1234, online: 50 };
    renames = [];
    requested = [];
    updates = [];
    channels = [
      channel('510000000000000001', 'Members: 1,000'),
      channel('510000000000000002', 'Roles: 3'),
      channel('510000000000000003', 'lounge'),
      channel('510000000000000004', 'Info', 4),
    ];
    config = {
      counters: [
        item({}),
        item({ channelId: '510000000000000002', type: 'roles', template: 'Roles: {count}' }),
        item({ channelId: '510000000000000009', type: 'voice', template: 'Voice: {count}' }),
      ],
    };
    const ctx = {
      enabled: async () => enabled,
      config: async () => config,
      update: async (_guild: string, patch: Partial<CountersConfig>, actor: { id: string }) => {
        updates.push({ patch, actor });
        config = { ...config, ...patch };
      },
      services: {
        log: createLogger('silent', false),
        settings: { config: async () => ({ timezone: 'UTC' }) },
        platform: {
          roles: async (id: string) => [id, '1', '2', '3'].map(role),
          channels: async () => channels,
          counts: () => counts,
          voiceMembers: (_guild: string, channelId: string) =>
            channelId === '510000000000000003' ? ['1', '2'] : [],
          requestCounts: (ids: string[]) => requested.push([...ids]),
          editChannel: async (channelId: string, input: { name: string }) => {
            renames.push({ channelId, name: input.name });
          },
        },
      },
    };
    board = new CounterBoard(ctx as never, async () => {});
  });

  it('renames only channels whose count changed', async () => {
    expect(await board.refresh(guild)).toBe(1);
    expect(renames).toEqual([{ channelId: '510000000000000001', name: 'Members: 1,234' }]);
  });

  it('waits between renames of the same channel', async () => {
    const start = new Date('2026-11-02T20:00:00Z');
    await board.refresh(guild, start);
    channels = [channel('510000000000000001', 'Members: 1,234'), ...channels.slice(1)];
    config = { counters: [item({ template: 'People: {count}' })] };
    expect(await board.refresh(guild, new Date(start.getTime() + 60_000))).toBe(0);
    expect(await board.refresh(guild, new Date(start.getTime() + RENAME_GAP))).toBe(1);
    expect(renames.at(-1)?.name).toBe('People: 1,234');
  });

  it('asks for counts first when the gateway has not sent any yet', async () => {
    counts = null;
    await board.refresh(guild);
    expect(requested).toEqual([[guild]]);
    counts = { members: 1234, online: 50 };
    await board.refresh(guild);
    expect(requested).toHaveLength(1);
  });

  it('does nothing while the module is off', async () => {
    enabled = false;
    expect(await board.refresh(guild)).toBe(0);
    expect(await board.tick([guild])).toBe(0);
    expect(requested).toEqual([]);
  });

  it('asks the gateway for fresh counts before a tick', async () => {
    expect(await board.tick([guild, '900000000000000041'])).toBe(1);
    expect(requested).toEqual([[guild, '900000000000000041']]);
  });

  it('counts voice members across voice channels', async () => {
    expect((await board.values(guild)).voice).toBe(2);
    expect((await board.values(guild)).channels).toBe(3);
    expect((await board.values(guild)).roles).toBe(3);
  });

  it('drops counters whose channel was deleted', async () => {
    await board.forgetChannel(guild, '510000000000000002');
    expect(updates).toHaveLength(1);
    expect(config.counters.map((entry) => entry.channelId)).toEqual([
      '510000000000000001',
      '510000000000000009',
    ]);
    await board.forgetChannel(guild, '510000000000000003');
    expect(updates).toHaveLength(1);
  });
});
