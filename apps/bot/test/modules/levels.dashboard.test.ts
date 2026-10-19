import { connect, migrate, type Sql, silentLogger } from '@maxwell/core';
import definition, { totalXpForLevel } from '@maxwell/core/modules/levels';
import { LevelStore } from '@maxwell/core/stores/levels';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('LevelStore dashboard queries', () => {
  let sql: Sql;
  let store: LevelStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, silentLogger, [{ module: 'levels', migrations: definition.migrations }]);
    store = new LevelStore(sql);
    await store.set(guild, '310000000000000001', totalXpForLevel(5));
    await store.set(guild, '310000000000000002', totalXpForLevel(5) + 10);
    await store.set(guild, '310000000000000003', totalXpForLevel(12));
    await store.set(guild, '310000000000000004', 3);
  });

  afterAll(async () => {
    await sql`delete from levels_members where guild_id = ${guild}`;
    await sql`delete from audit_entries where guild_id = ${guild}`;
    await sql.end();
  });

  it('counts members per level', async () => {
    expect(await store.levelCounts(guild, 'standard')).toEqual({ 5: 2, 12: 1 });
    const gentle = await store.levelCounts(guild, 'gentle');
    expect(Object.values(gentle).reduce((sum, n) => sum + n, 0)).toBe(3);
  });

  it('finds the last import that was not undone', async () => {
    expect(await store.lastImport(guild)).toBeNull();
    await sql`
      insert into audit_entries (guild_id, module, action, summary, after)
      values (${guild}, 'levels', 'xp.import', 'Imported', ${sql.json({ rows: 412 })})
    `;
    expect((await store.lastImport(guild))?.rows).toBe(412);
  });
});
