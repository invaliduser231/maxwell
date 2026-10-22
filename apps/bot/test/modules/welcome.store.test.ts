import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/welcome';
import { WelcomeStore } from '@maxwell/core/stores/welcome';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('WelcomeStore', () => {
  let sql: Sql;
  let store: WelcomeStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const user = '300000000000000001';

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'welcome', migrations: definition.migrations },
    ]);
    store = new WelcomeStore(sql);
  });

  afterAll(async () => {
    await sql`delete from welcome_rules where guild_id = ${guild}`;
    await sql`delete from welcome_accepted where guild_id = ${guild}`;
    await sql.end();
  });

  it('stores and replaces the rules message', async () => {
    expect(await store.rulesMessage(guild)).toBeNull();
    await store.setRulesMessage(guild, '400000000000000001', '500000000000000001');
    await store.setRulesMessage(guild, '400000000000000001', '500000000000000002');
    const row = await store.rulesMessage(guild);
    expect(row?.messageId).toBe('500000000000000002');
    expect(await store.clearRulesMessage(guild, '500000000000000001')).toBe(false);
    expect(await store.clearRulesMessage(guild, '500000000000000002')).toBe(true);
    expect(await store.rulesMessage(guild)).toBeNull();
  });

  it('records acceptance once', async () => {
    expect(await store.accept(guild, user)).toBe(true);
    expect(await store.accept(guild, user)).toBe(false);
    expect(await store.hasAccepted(guild, user)).toBe(true);
    expect(await store.acceptedCount(guild)).toBe(1);
    expect(await store.acceptedAt(guild, user)).toBeInstanceOf(Date);
    await store.revoke(guild, user);
    expect(await store.hasAccepted(guild, user)).toBe(false);
    expect(await store.acceptedAt(guild, user)).toBeNull();
  });
});
