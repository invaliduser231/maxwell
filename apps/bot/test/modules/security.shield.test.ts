import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/security';
import { ShieldStore } from '@maxwell/core/stores/shield';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('ShieldStore', () => {
  let sql: Sql;
  let store: ShieldStore;
  const base = BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));
  const a = String(base);
  const b = String(base + 1n);
  const c = String(base + 2n);
  const off = String(base + 3n);
  const raider = '360000000000000001';

  const setShield = (guildId: string, enabled: boolean) => sql`
    insert into guild_modules (guild_id, module, enabled, config)
    values (${guildId}, 'security', true, ${sql.json({ shield: { enabled } })})
    on conflict (guild_id, module) do update set config = excluded.config, enabled = true
  `;

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'security', migrations: definition.migrations },
    ]);
    store = new ShieldStore(sql);
    await sql`insert into guilds (id) values (${a}), (${b}), (${c}), (${off})`;
    for (const guildId of [a, b, c]) await setShield(guildId, true);
    await setShield(off, false);
  });

  afterAll(async () => {
    await sql`delete from security_shield_reports where guild_id in (${a}, ${b}, ${c}, ${off})`;
    await sql`delete from guild_modules where guild_id in (${a}, ${b}, ${c}, ${off})`;
    await sql`delete from guilds where id in (${a}, ${b}, ${c}, ${off})`;
    await sql.end();
  });

  it('only stores reports from communities that take part', async () => {
    expect(await store.participates(a)).toBe(true);
    expect(await store.participates(off)).toBe(false);
    expect(await store.report(off, raider, 'raid', null)).toBe(false);
    expect(await store.report(a, raider, 'raid', null)).toBe(true);
    expect(await store.report(b, raider, 'manual', '360000000000000009')).toBe(true);
    expect(await store.report(a, raider, 'nuke', null)).toBe(true);
    expect((await store.get(a, raider))?.source).toBe('nuke');
  });

  it('counts other taking-part communities only', async () => {
    expect(await store.elsewhere(raider, c)).toBe(2);
    expect(await store.elsewhere(raider, a)).toBe(1);
    await setShield(b, false);
    expect(await store.elsewhere(raider, c)).toBe(1);
    expect(await store.dropInactive()).toBeGreaterThanOrEqual(1);
    expect(await store.get(b, raider)).toBeNull();
    await setShield(b, true);
  });

  it('withdraws and expires reports', async () => {
    expect(await store.withdraw(a, raider)).toBe(true);
    expect(await store.elsewhere(raider, c)).toBe(0);
    await store.report(c, raider, 'severe', null, Date.now() - 91 * 86_400_000);
    expect(await store.elsewhere(raider, a)).toBe(0);
    expect(await store.purge()).toBeGreaterThanOrEqual(1);
    expect(await store.count(c)).toBe(0);
  });
});
