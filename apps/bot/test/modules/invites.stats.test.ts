import { connect, migrate, type Sql, silentLogger } from '@maxwell/core';
import { InviteStatsStore } from '@maxwell/core/stores/invites';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
const EPOCH = 1_420_070_400_000n;
const DAY = 86_400_000;

function idCreatedAt(ms: number, n: number): string {
  return String(((BigInt(ms) - EPOCH) << 22n) + BigInt(n));
}

describe.skipIf(!url)('InviteStatsStore', () => {
  let sql: Sql;
  let store: InviteStatsStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const lena = '310000000000000001';
  const kai = '310000000000000002';

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, silentLogger, []);
    store = new InviteStatsStore(sql);
    const now = Date.now();
    const join = (user: string, code: string, inviter: string, days: number, left?: number) => ({
      guild_id: guild,
      user_id: user,
      joined_at: new Date(now - days * DAY),
      left_at: left === undefined ? null : new Date(now - left * DAY),
      join_source: 1,
      invite_code: code,
      inviter_id: inviter,
      resolved_at: new Date(now - days * DAY),
    });
    const rows = [
      join('320000000000000001', 'aaa', lena, 40),
      join('320000000000000002', 'aaa', lena, 35, 33),
      join('320000000000000003', 'aaa', lena, 10),
      join('320000000000000004', 'bbb', kai, 2),
      join(idCreatedAt(now - 3 * DAY - 3_600_000, 5), 'bbb', kai, 3),
    ];
    await sql`insert into member_joins ${sql(rows)}`;
  });

  afterAll(async () => {
    await sql`delete from member_joins where guild_id = ${guild}`;
    await sql.end();
  });

  it('sums up retention and fake joins', async () => {
    const summary = await store.summary(guild);
    expect(summary.joins30).toBe(3);
    expect(summary.fake30).toBe(1);
    expect(summary.eligible7).toBe(3);
    expect(summary.stayed7).toBe(2);
    expect(summary.eligible30).toBe(2);
    expect(summary.stayed30).toBe(1);
  });

  it('groups joins by invite code', async () => {
    const codes = await store.codes(guild);
    expect(codes.map((code) => code.code)).toEqual(['aaa', 'bbb']);
    const [aaa, bbb] = codes;
    expect(aaa).toMatchObject({ inviterId: lena, joins: 3, joins30: 1, fake: 0, stayed30: 1 });
    expect(bbb).toMatchObject({ inviterId: kai, joins: 2, fake: 1, eligible7: 0 });
  });

  it('lists the latest joins of a code', async () => {
    const recent = await store.recent(guild, 'bbb');
    expect(recent).toHaveLength(2);
    expect(recent[0]?.userId).toBe('320000000000000004');
    expect(recent[1]?.fake).toBe(true);
  });

  it('ranks inviters by members who stayed', async () => {
    const board = await store.leaderboard(guild);
    expect(board).toEqual([
      { inviterId: lena, active: 2, total: 3, fake: 0 },
      { inviterId: kai, active: 2, total: 2, fake: 1 },
    ]);
  });
});
