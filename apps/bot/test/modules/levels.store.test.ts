import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/levels';
import { LevelStore, levelOf } from '@maxwell/core/stores/levels';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('LevelStore', () => {
  let sql: Sql;
  let store: LevelStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const lena = '310000000000000001';
  const max = '310000000000000002';
  const ada = '310000000000000003';

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'levels', migrations: definition.migrations },
    ]);
    store = new LevelStore(sql);
  });

  afterAll(async () => {
    await sql`delete from levels_members where guild_id = ${guild}`;
    await sql`delete from levels_snapshots where guild_id = ${guild}`;
    await sql`delete from guild_modules where guild_id = ${guild}`;
    await sql`delete from guild_assets where guild_id = ${guild}`;
    await sql`delete from guilds where id = ${guild}`;
    await sql.end();
  });

  it('awards XP once per cooldown', async () => {
    expect(await store.award(guild, lena, 20, 60)).toBe(20);
    expect(await store.award(guild, lena, 20, 60)).toBeNull();
    expect(await store.award(guild, lena, 15, 0)).toBe(35);
  });

  it('ranks members by XP', async () => {
    await store.set(guild, max, 500);
    await store.set(guild, ada, 120);
    expect(await store.standing(guild, max)).toEqual({ userId: max, xp: 500, rank: 1 });
    expect(await store.standing(guild, lena)).toEqual({ userId: lena, xp: 35, rank: 3 });
    expect(await store.ranked(guild)).toBe(3);
    const board = await store.leaderboard(guild, 2, 1);
    expect(board).toEqual([
      { userId: ada, xp: 120, rank: 2 },
      { userId: lena, xp: 35, rank: 3 },
    ]);
  });

  it('adds and takes without going below zero', async () => {
    expect(await store.add(guild, ada, 80)).toEqual({ before: 120, after: 200 });
    expect(await store.add(guild, ada, -500)).toEqual({ before: 200, after: 0 });
    expect(await store.standing(guild, ada)).toBeNull();
    expect(await store.set(guild, ada, 120)).toBe(0);
  });

  it('reads levels with the configured curve', async () => {
    expect(await levelOf(sql, guild, max)).toBe(3);
    await sql`insert into guilds (id) values (${guild}) on conflict do nothing`;
    await sql`
      insert into guild_modules (guild_id, module, config)
      values (${guild}, 'levels', ${sql.json({ curve: 'linear' })})
    `;
    expect(await levelOf(sql, guild, max)).toBe(3);
    await store.set(guild, max, 1_000);
    expect(await levelOf(sql, guild, max)).toBe(5);
    expect(await levelOf(sql, guild, '310000000000000099')).toBe(0);
  });

  it('imports and restores through a snapshot', async () => {
    const result = await store.importEntries(guild, [
      { userId: lena, xp: 9_000 },
      { userId: '310000000000000004', xp: 50 },
    ]);
    expect(result.count).toBe(2);
    expect(await store.xp(guild, lena)).toBe(9_000);

    const added = await store.importEntries(guild, [{ userId: lena, xp: 1_000 }], 'add');
    expect(await store.xp(guild, lena)).toBe(10_000);
    await store.restore(guild, added.snapshotId);
    expect(await store.xp(guild, lena)).toBe(9_000);

    expect(await store.restore(guild, result.snapshotId)).toBe(1);
    expect(await store.xp(guild, lena)).toBe(35);
    expect(await store.xp(guild, '310000000000000004')).toBe(0);
    expect(await store.restore(guild, result.snapshotId)).toBe(0);
  });

  it('keeps the higher value in max mode', async () => {
    const snap = await store.importEntries(guild, [{ userId: max, xp: 10 }], 'max');
    expect(await store.xp(guild, max)).toBe(1_000);
    await store.restore(guild, snap.snapshotId);
  });

  it('resets everyone and brings them back', async () => {
    const result = await store.resetAll(guild);
    expect(result.count).toBe(3);
    expect(await store.ranked(guild)).toBe(0);
    expect(await store.restore(guild, result.snapshotId)).toBe(3);
    expect(await store.xp(guild, max)).toBe(1_000);
  });

  it('prunes old snapshots', async () => {
    await store.importEntries(guild, [{ userId: lena, xp: 35 }]);
    expect(await store.pruneSnapshots(new Date(Date.now() + 1_000))).toBeGreaterThan(0);
    const [left] = await sql`select 1 from levels_snapshots where guild_id = ${guild}`;
    expect(left).toBeUndefined();
  });

  it('reads guild assets by key', async () => {
    await sql`insert into guilds (id) values (${guild}) on conflict do nothing`;
    await sql`
      insert into guild_assets (guild_id, key, content_type, data)
      values (${guild}, 'shop:sunset', 'image/png', ${Buffer.from([1, 2, 3])})
    `;
    expect([...((await store.asset(guild, 'shop:sunset')) ?? [])]).toEqual([1, 2, 3]);
    expect(await store.asset(guild, 'shop:none')).toBeNull();
  });

  it('exports and forgets one member, snapshots included', async () => {
    await store.set(guild, ada, 400);
    const snap = await store.importEntries(guild, [{ userId: ada, xp: 900 }]);
    const data = await store.memberData(guild, ada);
    expect(data).toMatchObject({ xp: 900, rank: 2 });
    expect(await store.memberData(guild, '310000000000000098')).toBeNull();

    await store.forget(guild, ada);
    expect(await store.memberData(guild, ada)).toBeNull();
    expect(await store.xp(guild, max)).toBe(1_000);
    const rows = await sql`
      select 1 from levels_snapshot_rows where snapshot_id = ${snap.snapshotId} and user_id = ${ada}
    `;
    expect(rows).toHaveLength(0);
    await store.restore(guild, snap.snapshotId);
    expect(await store.xp(guild, ada)).toBe(0);
  });
});
