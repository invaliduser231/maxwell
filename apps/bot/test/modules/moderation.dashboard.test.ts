import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/moderation';
import { ModerationStore } from '@maxwell/core/stores/moderation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('ModerationStore dashboard queries', () => {
  let sql: Sql;
  let store: ModerationStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const lena = '400000000000000101';
  const max = '400000000000000102';
  const fresh = String((BigInt(Date.now() - 1_420_070_400_000 - 3_600_000) << 22n) + 5n);
  const mod = '400000000000000109';

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'moderation', migrations: definition.migrations },
    ]);
    store = new ModerationStore(sql);
    await store.create({ guildId: guild, action: 'warn', userId: lena, moderatorId: mod });
    await store.create({
      guildId: guild,
      action: 'timeout',
      userId: max,
      moderatorId: null,
      durationSeconds: 3_600,
      expiresAt: new Date(Date.now() + 3_600_000),
      meta: { source: 'automod' },
    });
    await store.create({
      guildId: guild,
      action: 'ban',
      userId: max,
      moderatorId: mod,
      reason: 'raid',
    });
    await store.recordName(guild, lena, 'username', 'lena', null, true);
    await store.recordName(guild, lena, 'display', 'Lena', null, false);
    await sql`
      insert into member_joins (guild_id, user_id, joined_at, invite_code, inviter_id)
      values
        (${guild}, ${fresh}, now() - interval '10 minutes', 'abc123', ${lena}),
        (${guild}, ${max}, now() - interval '40 days', 'abc123', ${lena})
    `;
    await sql`
      update member_joins set left_at = now() where guild_id = ${guild} and user_id = ${max}
    `;
  });

  afterAll(async () => {
    await sql`delete from moderation_cases where guild_id = ${guild}`;
    await sql`delete from moderation_counters where guild_id = ${guild}`;
    await sql`delete from moderation_names where guild_id = ${guild}`;
    await sql`delete from member_joins where guild_id = ${guild}`;
    await sql.end();
  });

  it('sums up active punishments and automated cases', async () => {
    const overview = await store.overview(guild);
    expect(overview.activeTimeouts).toBe(1);
    expect(overview.activeBans).toBe(1);
    expect(overview.temporaryBans).toBe(0);
    expect(overview.warns30).toBe(1);
    expect(overview.warned30).toBe(1);
    expect(overview.total30).toBe(3);
    expect(overview.automated30).toBe(1);
    expect(overview.timeoutEndsAt).toBeInstanceOf(Date);
  });

  it('pages cases with an offset', async () => {
    const first = await store.list(guild, { limit: 2 });
    const second = await store.list(guild, { limit: 2, offset: 2 });
    expect(first.map((row) => row.number)).toEqual([3, 2]);
    expect(second.map((row) => row.number)).toEqual([1]);
  });

  it('lists flagged members with their flags', async () => {
    const rows = await store.memberList(guild, { view: 'flagged', expiryDays: 90 });
    const byId = new Map(rows.map((row) => [row.userId, row]));
    expect(byId.get(lena)?.activeWarns).toBe(1);
    expect(byId.get(lena)?.display).toBe('Lena');
    expect(byId.get(lena)?.username).toBe('lena');
    expect(byId.get(max)?.banned).toBe(true);
    expect(byId.get(max)?.timedOut).toBe(true);
    expect(byId.get(fresh)?.newAccount).toBe(true);
  });

  it('lists new members and finds members by name, id and invite', async () => {
    const recent = await store.memberList(guild, { view: 'new', expiryDays: 90 });
    expect(recent.map((row) => row.userId)).toEqual([fresh]);
    const named = await store.memberList(guild, { view: 'all', search: 'len', expiryDays: 90 });
    expect(named.map((row) => row.userId)).toEqual([lena]);
    const byId = await store.memberList(guild, { view: 'all', search: max, expiryDays: 90 });
    expect(byId.map((row) => row.userId)).toEqual([max]);
    const byInvite = await store.memberList(guild, {
      view: 'all',
      search: 'ABC1',
      expiryDays: 90,
    });
    expect(byInvite.map((row) => row.userId).sort()).toEqual([fresh, max].sort());
    const all = await store.memberList(guild, { view: 'all', expiryDays: 90 });
    expect(all.map((row) => row.userId).sort()).toEqual([fresh, lena, max].sort());
  });

  it('reads joins and invited members', async () => {
    const joins = await store.joins(guild, fresh);
    expect(joins[0]?.inviteCode).toBe('abc123');
    expect(joins[0]?.inviterId).toBe(lena);
    expect(await store.invited(guild, lena)).toEqual({ total: 2, stayed: 1 });
  });
});
