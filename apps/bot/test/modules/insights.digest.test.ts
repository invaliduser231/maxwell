import { connect, migrate, type Sql, silentLogger } from '@maxwell/core';
import { generalConfig } from '@maxwell/core/modules/general';
import definition, { insightsConfig } from '@maxwell/core/modules/insights';
import moderation from '@maxwell/core/modules/moderation';
import type { InboxStore } from '@maxwell/core/stores/inbox';
import { type DigestNumbers, InsightsStore } from '@maxwell/core/stores/insights';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultStyle } from '../../src/cards/theme.js';
import {
  counted,
  digestRanges,
  dueWeek,
  isoWeek,
  localClock,
  WeeklyDigest,
} from '../../src/modules/insights/digest.js';
import type { OutgoingMessage } from '../../src/platform/types.js';
import type { ModuleContext } from '../../src/runtime/module.js';

const url = process.env.TEST_DATABASE_URL;

const empty: DigestNumbers = {
  joins: 0,
  leaves: 0,
  messages: 0,
  activeMembers: 0,
  channels: [],
  moderation: { warn: 0, timeout: 0, kick: 0, ban: 0 },
};

describe('digest timing', () => {
  it('reads the local weekday and hour in the community timezone', () => {
    expect(localClock(new Date('2026-10-26T08:30:00Z'), 'Europe/Berlin')).toEqual({
      day: '2026-10-26',
      weekday: 0,
      hour: 9,
    });
    expect(localClock(new Date('2026-10-25T23:30:00Z'), 'UTC')).toEqual({
      day: '2026-10-25',
      weekday: 6,
      hour: 23,
    });
    expect(localClock(new Date('2026-10-26T00:30:00Z'), 'Mars/Olympus').hour).toBe(0);
  });

  it('names ISO weeks across year boundaries', () => {
    expect(isoWeek('2026-10-26')).toBe('2026-W44');
    expect(isoWeek('2026-11-01')).toBe('2026-W44');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
    expect(isoWeek('2024-12-30')).toBe('2025-W01');
    expect(isoWeek('2021-01-03')).toBe('2020-W53');
  });

  it('is due from the chosen hour on the chosen day only', () => {
    const config = { digestChannelId: '9', digestDay: 0, digestHour: 9 };
    const berlin = 'Europe/Berlin';
    expect(dueWeek(config, new Date('2026-10-26T08:00:00Z'), berlin)).toBe('2026-W44');
    expect(dueWeek(config, new Date('2026-10-26T20:00:00Z'), berlin)).toBe('2026-W44');
    expect(dueWeek(config, new Date('2026-10-26T07:00:00Z'), berlin)).toBeNull();
    expect(dueWeek(config, new Date('2026-10-27T08:00:00Z'), berlin)).toBeNull();
    expect(
      dueWeek({ ...config, digestChannelId: null }, new Date('2026-10-26T08:00:00Z'), berlin),
    ).toBeNull();
    expect(
      dueWeek(
        { ...config, digestDay: 6, digestHour: 23 },
        new Date('2026-11-01T22:00:00Z'),
        berlin,
      ),
    ).toBe('2026-W44');
  });

  it('covers the last seven full days and the seven before', () => {
    const { current, previous } = digestRanges(new Date('2026-10-26T08:00:00Z'));
    expect(current).toEqual({
      from: new Date('2026-10-19T00:00:00Z'),
      to: new Date('2026-10-26T00:00:00Z'),
    });
    expect(previous).toEqual({
      from: new Date('2026-10-12T00:00:00Z'),
      to: new Date('2026-10-19T00:00:00Z'),
    });
  });

  it('only compares against weeks that have data', () => {
    expect(counted(empty)).toBe(false);
    expect(counted({ ...empty, moderation: { ...empty.moderation, ban: 1 } })).toBe(true);
    expect(counted({ ...empty, messages: 1 })).toBe(true);
  });
});

describe('WeeklyDigest', () => {
  function setup(missing: Record<string, string[]> = {}) {
    const claims = new Set<string>();
    const sent: { channelId: string; message: OutgoingMessage }[] = [];
    const configs: Record<string, ReturnType<typeof insightsConfig.parse>> = {
      g1: insightsConfig.parse({ digestChannelId: 'c1', digestDay: 0, digestHour: 9 }),
      g2: insightsConfig.parse({ digestChannelId: 'c2', digestDay: 0, digestHour: 9 }),
      g3: insightsConfig.parse({ digestChannelId: 'c3', digestDay: 3, digestHour: 9 }),
      g4: insightsConfig.parse({ digestChannelId: 'gone', digestDay: 3, digestHour: 9 }),
    };
    const store = {
      digestGuilds: async () => Object.keys(configs),
      digest: async () => ({ ...empty, messages: 12, channels: [{ channelId: 'c1', count: 12 }] }),
      claimDigest: async (guildId: string, week: string) => {
        const key = `${guildId}:${week}`;
        if (claims.has(key)) return false;
        claims.add(key);
        return true;
      },
      releaseDigest: async (guildId: string, week: string) => {
        claims.delete(`${guildId}:${week}`);
      },
    } as unknown as InsightsStore;
    const inbox = {
      counts: async () => ({ open: 2, claimed: 1, mine: 0 }),
    } as unknown as InboxStore;
    const ctx = {
      services: {
        platform: {
          channelInGuild: async (_guildId: string, channelId: string) => channelId !== 'gone',
          missingBotPermissions: async (guildId: string) => missing[guildId] ?? [],
          send: async (channelId: string, message: OutgoingMessage) => {
            sent.push({ channelId, message });
            return 'm1';
          },
          guild: async (id: string) => ({ id, name: 'Example', memberCount: 10, iconUrl: null }),
          channels: async () => [{ id: 'c1', name: 'general' }],
        },
        cards: { forGuild: async () => defaultStyle },
        settings: {
          config: async () => generalConfig.parse({ timezone: 'Europe/Berlin' }),
        },
        log: { warn: () => {}, debug: () => {}, info: () => {}, error: () => {} },
      },
      config: async (guildId: string) => configs[guildId],
      enabled: async () => true,
    } as unknown as ModuleContext<typeof insightsConfig>;
    let flushed = 0;
    const digest = new WeeklyDigest(ctx, store, inbox, async () => {
      flushed += 1;
    });
    return { digest, sent, claims, flushed: () => flushed };
  }

  it('posts once per week to communities that are due', async () => {
    const { digest, sent, flushed } = setup();
    const monday = new Date('2026-10-26T08:05:00Z');
    expect(await digest.tick(new Date('2026-10-26T07:05:00Z'))).toBe(0);
    expect(await digest.tick(monday)).toBe(2);
    expect(await digest.tick(new Date('2026-10-26T09:05:00Z'))).toBe(0);
    expect(sent.map((item) => item.channelId)).toEqual(['c1', 'c2']);
    expect(sent[0]?.message.files?.[0]?.name).toBe('weekly-digest.png');
    expect(flushed()).toBe(2);
    expect(await digest.tick(new Date('2026-11-02T08:05:00Z'))).toBe(2);
  });

  it('frees the week again when the channel cannot be used', async () => {
    const { digest, sent, claims } = setup({ g2: ['AttachFiles'] });
    expect(await digest.tick(new Date('2026-10-26T08:05:00Z'))).toBe(1);
    expect([...claims]).toEqual(['g1:2026-W44']);
    expect(sent.map((item) => item.channelId)).toEqual(['c1']);
  });

  it('sends a test digest without claiming the week', async () => {
    const { digest, sent, claims } = setup();
    expect(await digest.test('g3')).toBe(true);
    expect(await digest.test('g3')).toBe(true);
    expect(await digest.test('g4')).toBe(false);
    expect(sent.map((item) => item.channelId)).toEqual(['c3', 'c3']);
    expect(claims.size).toBe(0);
  });
});

describe.skipIf(!url)('InsightsStore digest', () => {
  let sql: Sql;
  let store: InsightsStore;
  const id = () =>
    String(BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)));
  const guild = id();
  const quiet = id();
  const now = new Date('2026-10-19T09:00:00Z');
  const { current, previous } = digestRanges(now);

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, silentLogger, [
      { module: 'insights', migrations: definition.migrations },
      { module: 'moderation', migrations: moderation.migrations },
    ]);
    store = new InsightsStore(sql);
  });

  afterAll(async () => {
    for (const target of [guild, quiet]) {
      await store.forgetGuild(target);
      await sql`delete from moderation_cases where guild_id = ${target}`;
      await sql`delete from guild_modules where guild_id = ${target}`;
      await sql`delete from guilds where id = ${target}`;
    }
    await sql.end();
  });

  it('sums a week from the rollups and the case log', async () => {
    const hour = (iso: string) => new Date(iso);
    await store.write({
      messages: [
        { guildId: guild, hour: hour('2026-10-13T10:00:00Z'), channelId: '11', count: 30 },
        { guildId: guild, hour: hour('2026-10-14T10:00:00Z'), channelId: '12', count: 10 },
        { guildId: guild, hour: hour('2026-10-14T11:00:00Z'), channelId: '13', count: 5 },
        { guildId: guild, hour: hour('2026-10-18T23:00:00Z'), channelId: '14', count: 1 },
        { guildId: guild, hour: hour('2026-10-19T00:00:00Z'), channelId: '14', count: 50 },
        { guildId: guild, hour: hour('2026-10-06T10:00:00Z'), channelId: '11', count: 20 },
      ],
      active: [
        { guildId: guild, day: '2026-10-13', userId: '21', count: 3 },
        { guildId: guild, day: '2026-10-13', userId: '22', count: 1 },
        { guildId: guild, day: '2026-10-14', userId: '21', count: 2 },
        { guildId: guild, day: '2026-10-06', userId: '23', count: 2 },
      ],
      members: [
        { guildId: guild, day: '2026-10-13', joins: 3, leaves: 1 },
        { guildId: guild, day: '2026-10-06', joins: 1, leaves: 0 },
      ],
      voice: [],
      moderation: [
        { guildId: guild, day: '2026-10-14', action: 'kick', actorId: '41', count: 3 },
        { guildId: guild, day: '2026-10-15', action: 'ban', actorId: null, count: 1 },
      ],
    });
    const cases: [number, string, string, string | null][] = [
      [1, 'warn', '2026-10-14T10:00:00Z', null],
      [2, 'warn', '2026-10-14T11:00:00Z', '2026-10-15T10:00:00Z'],
      [3, 'timeout', '2026-10-15T10:00:00Z', null],
      [4, 'kick', '2026-10-16T10:00:00Z', null],
      [5, 'ban', '2026-10-04T10:00:00Z', null],
      [6, 'flag', '2026-10-16T10:00:00Z', null],
    ];
    for (const [number, action, created, voided] of cases) {
      await sql`
        insert into moderation_cases (guild_id, number, action, created_at, voided_at)
        values (${guild}, ${number}, ${action}, ${created}, ${voided})
      `;
    }

    expect(await store.digest(guild, current)).toEqual({
      joins: 3,
      leaves: 1,
      messages: 46,
      activeMembers: 2,
      channels: [
        { channelId: '11', count: 30 },
        { channelId: '12', count: 10 },
        { channelId: '13', count: 5 },
      ],
      moderation: { warn: 1, timeout: 1, kick: 3, ban: 1 },
    });
    const before = await store.digest(guild, previous);
    expect(before).toMatchObject({ joins: 1, leaves: 0, messages: 20, activeMembers: 1 });
    expect(before.moderation).toEqual({ warn: 0, timeout: 0, kick: 0, ban: 0 });
    expect(counted(await store.digest(quiet, current))).toBe(false);
  });

  it('lists communities with a digest channel and claims each week once', async () => {
    await sql`insert into guilds (id) values (${guild}), (${quiet})`;
    await sql`
      insert into guild_modules (guild_id, module, enabled, config) values
        (${guild}, 'insights', true, ${sql.json({ digestChannelId: '99' })}),
        (${quiet}, 'insights', true, ${sql.json({ digestChannelId: null })})
    `;
    const guilds = await store.digestGuilds();
    expect(guilds).toContain(guild);
    expect(guilds).not.toContain(quiet);

    expect(await store.claimDigest(guild, '2026-W43', '99')).toBe(true);
    expect(await store.claimDigest(guild, '2026-W43', '99')).toBe(false);
    expect(await store.claimDigest(guild, '2026-W44', '99')).toBe(true);
    await store.releaseDigest(guild, '2026-W43');
    expect(await store.claimDigest(guild, '2026-W43', '99')).toBe(true);
  });
});
