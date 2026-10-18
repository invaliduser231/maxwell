import { connect, migrate, type Sql, silentLogger } from '@maxwell/core';
import definition from '@maxwell/core/modules/insights';
import { InsightsStore, safeTimezone } from '@maxwell/core/stores/insights';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe('safeTimezone', () => {
  it('falls back to UTC for unknown zones', () => {
    expect(safeTimezone('Europe/Berlin')).toBe('Europe/Berlin');
    expect(safeTimezone('Mars/Olympus')).toBe('UTC');
  });
});

describe.skipIf(!url)('InsightsStore', () => {
  let sql: Sql;
  let store: InsightsStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const day = (offset: number) => new Date(Date.now() - offset * 86_400_000);
  const utc = (date: Date) => date.toISOString().slice(0, 10);
  const hour = (date: Date) => new Date(Math.floor(date.getTime() / 3_600_000) * 3_600_000);
  const range = { from: day(60), to: new Date(Date.now() + 86_400_000) };

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, silentLogger, [{ module: 'insights', migrations: definition.migrations }]);
    store = new InsightsStore(sql);
  });

  afterAll(async () => {
    await store.forgetGuild(guild);
    await sql`delete from member_joins where guild_id = ${guild}`;
    await sql`delete from audit_entries where guild_id = ${guild}`;
    await sql`delete from guild_modules where guild_id = ${guild}`;
    await sql`delete from guilds where id = ${guild}`;
    await sql.end();
  });

  it('adds batches onto existing rollups', async () => {
    const now = new Date();
    const batch = {
      messages: [{ guildId: guild, hour: hour(now), channelId: '11', count: 3 }],
      active: [{ guildId: guild, day: utc(now), userId: '21', count: 3 }],
      members: [{ guildId: guild, day: utc(now), joins: 2, leaves: 1 }],
      voice: [{ guildId: guild, day: utc(now), channelId: '31', seconds: 90 }],
    };
    expect(await store.write(batch)).toBe(4);
    await store.write(batch);
    await store.write({
      messages: [{ guildId: guild, hour: hour(now), channelId: '12', count: 1 }],
      active: [{ guildId: guild, day: utc(now), userId: '22', count: 1 }],
      members: [],
      voice: [],
    });

    const summary = await store.summary(guild, range);
    expect(summary).toEqual({
      messages: 7,
      activeMembers: 2,
      joins: 4,
      leaves: 2,
      voiceMinutes: 3,
      moderationActions: 0,
    });
    expect(await store.topChannels(guild, range)).toEqual([
      { channelId: '11', count: 6 },
      { channelId: '12', count: 1 },
    ]);
    expect(await store.activeMembers(guild, range)).toEqual([{ day: utc(now), count: 2 }]);
    expect(await store.memberFlow(guild, range)).toEqual([{ day: utc(now), joins: 4, leaves: 2 }]);
    expect(await store.voiceMinutes(guild, range)).toEqual([{ day: utc(now), count: 3 }]);
    expect(await store.topMembers(guild, range, 1)).toEqual([{ userId: '21', count: 6 }]);
  });

  it('builds a timeline and an hourly heatmap in the guild timezone', async () => {
    const monday = new Date(Date.UTC(2026, 9, 19, 22, 0));
    await store.write({
      messages: [{ guildId: guild, hour: monday, channelId: '11', count: 5 }],
      active: [],
      members: [],
      voice: [],
    });
    const window = { from: new Date(Date.UTC(2026, 9, 19)), to: new Date(Date.UTC(2026, 9, 20)) };
    expect(await store.heatmap(guild, window)).toEqual([{ weekday: 0, hour: 22, messages: 5 }]);
    expect(await store.heatmap(guild, window, 'Europe/Berlin')).toEqual([
      { weekday: 1, hour: 0, messages: 5 },
    ]);
    expect(await store.messages(guild, window, 'hour')).toEqual([
      { at: '2026-10-19T22:00', messages: 5 },
    ]);
    expect(await store.messages(guild, window, 'day', 'Europe/Berlin')).toEqual([
      { at: '2026-10-20', messages: 5 },
    ]);
  });

  it('counts moderation load from the audit trail', async () => {
    await sql`
      insert into audit_entries (guild_id, actor_id, module, action, summary)
      values
        (${guild}, 41, 'moderation', 'ban', 'x'),
        (${guild}, 41, 'moderation', 'ban', 'x'),
        (${guild}, null, 'automod', 'delete', 'x'),
        (${guild}, 41, 'welcome', 'config.update', 'x')
    `;
    const load = await store.moderationLoad(guild, range);
    expect(load.map((row) => [row.module, row.action, row.count])).toEqual([
      ['automod', 'delete', 1],
      ['moderation', 'ban', 2],
    ]);
    expect(await store.moderators(guild, range)).toEqual([
      { actorId: '41', count: 2 },
      { actorId: null, count: 1 },
    ]);
  });

  it('adds native bans and kicks without touching the audit trail counts', async () => {
    const today = utc(new Date());
    await store.write({
      messages: [],
      active: [],
      members: [],
      voice: [],
      moderation: [
        { guildId: guild, day: today, action: 'ban', actorId: '41', count: 1 },
        { guildId: guild, day: today, action: 'kick', actorId: '42', count: 3 },
        { guildId: guild, day: today, action: 'kick', actorId: null, count: 1 },
      ],
    });
    await store.write({
      messages: [],
      active: [],
      members: [],
      voice: [],
      moderation: [{ guildId: guild, day: today, action: 'kick', actorId: '42', count: 1 }],
    });
    const load = await store.moderationLoad(guild, range);
    expect(
      load.filter((row) => row.module === 'native').map((row) => [row.action, row.count]),
    ).toEqual([
      ['ban', 1],
      ['kick', 5],
    ]);
    expect(load.filter((row) => row.module === 'moderation')).toEqual([
      { day: today, module: 'moderation', action: 'ban', count: 2 },
    ]);
    expect(await store.moderators(guild, range)).toEqual([
      { actorId: '42', count: 4 },
      { actorId: '41', count: 3 },
      { actorId: null, count: 2 },
    ]);
    expect((await store.summary(guild, range)).moderationActions).toBe(9);
  });

  it('exports and forgets a member, keeping moderation totals', async () => {
    const today = utc(new Date());
    expect(await store.member(guild, '42')).toEqual({
      activity: [],
      moderation: [{ day: today, action: 'kick', count: 4 }],
    });
    expect((await store.member(guild, '22')).activity).toEqual([{ day: today, messages: 1 }]);
    await store.forgetUser(guild, '42');
    expect(await store.member(guild, '42')).toEqual({ activity: [], moderation: [] });
    expect(await store.moderators(guild, range)).toEqual([
      { actorId: null, count: 6 },
      { actorId: '41', count: 3 },
    ]);
    expect((await store.summary(guild, range)).moderationActions).toBe(9);
  });

  it('measures retention per invite', async () => {
    const rows = [
      { user: '51', joined: day(40), left: null },
      { user: '52', joined: day(40), left: day(38) },
      { user: '53', joined: day(10), left: null },
      { user: '54', joined: day(2), left: null },
    ];
    for (const row of rows) {
      await sql`
        insert into member_joins (guild_id, user_id, joined_at, left_at, join_source, invite_code, inviter_id, resolved_at)
        values (${guild}, ${row.user}, ${row.joined}, ${row.left}, 1, 'spring', 61, now())
      `;
    }
    await store.write({
      messages: [],
      active: [{ guildId: guild, day: utc(day(25)), userId: '51', count: 4 }],
      members: [],
      voice: [],
    });
    const [spring] = await store.inviteRetention(guild, range);
    expect(spring).toEqual({
      inviteCode: 'spring',
      inviterId: '61',
      joins: 4,
      eligible7: 3,
      stayed7: 2,
      eligible30: 2,
      stayed30: 1,
      active30: 1,
    });
  });

  it('prunes rows past the configured retention', async () => {
    await sql`insert into guilds (id) values (${guild}) on conflict do nothing`;
    await sql`
      insert into guild_modules (guild_id, module, config)
      values (${guild}, 'insights', ${sql.json({ retentionDays: 30 })})
      on conflict (guild_id, module) do update set config = excluded.config
    `;
    await store.write({
      messages: [{ guildId: guild, hour: hour(day(45)), channelId: '11', count: 1 }],
      active: [],
      members: [{ guildId: guild, day: utc(day(45)), joins: 1, leaves: 0 }],
      voice: [],
    });
    expect(await store.prune()).toBeGreaterThanOrEqual(2);
    const [left] = await sql<{ count: number }[]>`
      select count(*)::int as count from insights_messages
      where guild_id = ${guild} and hour < now() - interval '30 days'
    `;
    expect(left?.count).toBe(0);
  });

  it('forgets a member', async () => {
    await store.forgetUser(guild, '21');
    expect((await store.topMembers(guild, range)).map((row) => row.userId)).not.toContain('21');
  });
});
