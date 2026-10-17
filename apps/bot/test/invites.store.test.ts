import { connect, migrate, type Sql } from '@maxwell/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';
import { InviteStore } from '../src/modules/invites/store.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('InviteStore', () => {
  let sql: Sql;
  let store: InviteStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const inviter = '200000000000000001';
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 21, 12, minutes));

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false));
    store = new InviteStore(sql);
  });

  afterAll(async () => {
    await sql`delete from member_joins where guild_id = ${guild}`;
    await sql.end();
  });

  it('records each join once', async () => {
    const first = await store.recordJoin(guild, '300000000000000001', at(0));
    const again = await store.recordJoin(guild, '300000000000000001', at(0));
    expect(first?.userId).toBe('300000000000000001');
    expect(again).toBeNull();
  });

  it('counts active and departed invites per inviter', async () => {
    const a = await store.recordJoin(guild, '300000000000000002', at(1));
    const b = await store.recordJoin(guild, '300000000000000003', at(2));
    const first = await store.latestJoin(guild, '300000000000000001');
    const source = { type: 1, inviteCode: 'abc', inviterId: inviter };
    for (const row of [first, a, b]) if (row) await store.resolve(row.id, source);
    await store.recordLeave(guild, '300000000000000003');

    expect(await store.inviterStats(guild, inviter)).toEqual({ total: 3, active: 2, left: 1 });
  });

  it('counts a member who rejoins only once', async () => {
    const back = await store.recordJoin(guild, '300000000000000003', at(10));
    if (back) await store.resolve(back.id, { type: 1, inviteCode: 'abc', inviterId: inviter });
    expect(await store.inviterStats(guild, inviter)).toEqual({ total: 3, active: 3, left: 0 });
  });

  it('ranks inviters', async () => {
    const other = await store.recordJoin(guild, '300000000000000009', at(20));
    if (other)
      await store.resolve(other.id, {
        type: 1,
        inviteCode: 'xyz',
        inviterId: '200000000000000002',
      });
    const board = await store.leaderboard(guild);
    expect(board.map((row) => row.inviterId)).toEqual([inviter, '200000000000000002']);
  });

  it('lists joins still waiting for a lookup', async () => {
    await store.recordJoin(guild, '300000000000000010', at(30));
    const pending = await store.unresolved(at(25));
    expect(
      pending.some((row) => row.userId === '300000000000000010' && row.guildId === guild),
    ).toBe(true);
  });
});
