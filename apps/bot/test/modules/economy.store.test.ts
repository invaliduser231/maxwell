import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/economy';
import { EconomyStore } from '@maxwell/core/stores/economy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('EconomyStore', () => {
  let sql: Sql;
  let store: EconomyStore;
  const guild = String(910_000_000_000_000n + BigInt(Math.floor(Math.random() * 1_000_000_000)));
  const a = '400000000000000001';
  const b = '400000000000000002';
  const c = '400000000000000003';

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'economy', migrations: definition.migrations },
    ]);
    store = new EconomyStore(sql);
  });

  afterAll(async () => {
    for (const table of [
      'economy_wallets',
      'economy_transactions',
      'economy_supply',
      'economy_stock',
      'economy_purchases',
      'economy_inventory',
    ]) {
      await sql`delete from ${sql(table)} where guild_id = ${guild}`;
    }
    await sql.end();
  });

  it('credits, debits and keeps a ledger row per change', async () => {
    expect(await store.credit(guild, a, 100, 'admin')).toBe(100);
    expect(await store.debit(guild, a, 30, 'shop')).toBe(true);
    expect(await store.debit(guild, a, 500, 'shop')).toBe(false);
    expect(await store.balance(guild, a)).toBe(70);
    const rows = await store.transactions(guild, { userId: a });
    expect(rows.map((row) => row.amount)).toEqual([-30, 100]);
    expect(rows[0]?.balance).toBe(70);
  });

  it('never lets concurrent debits overdraw', async () => {
    await store.credit(guild, b, 50, 'admin');
    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.debit(guild, b, 10, 'shop')),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(await store.balance(guild, b)).toBe(0);
  });

  it('caps daily earnings', async () => {
    const first = await store.earn(guild, c, 40, 'message', 50);
    const second = await store.earn(guild, c, 40, 'message', 50);
    const third = await store.earn(guild, c, 40, 'message', 50);
    expect([first.credited, second.credited, third.credited]).toEqual([40, 10, 0]);
    expect((await store.wallet(guild, c)).earnedToday).toBe(50);
  });

  it('taxes transfers and burns the tax', async () => {
    const before = await store.totalSupply(guild);
    const result = await store.transfer(guild, a, c, 50, 10);
    expect(result).toMatchObject({ ok: true, tax: 5, received: 45, balance: 20 });
    expect(await store.totalSupply(guild)).toBe(before - 5);
    expect((await store.transfer(guild, a, c, 1000, 10)).ok).toBe(false);
  });

  it('pays the daily once per day and tracks the streak', async () => {
    const rules = { amount: 100, streakBonus: 10, streakCap: 7 };
    const day = new Date(Date.UTC(2026, 9, 1, 12));
    const first = await store.claimDaily(guild, b, rules, day);
    expect(first).toMatchObject({ ok: true, amount: 100, streak: 1 });
    const again = await store.claimDaily(guild, b, rules, new Date(day.getTime() + 3_600_000));
    expect(again.ok).toBe(false);
    const next = await store.claimDaily(guild, b, rules, new Date(day.getTime() + 25 * 3_600_000));
    expect(next).toMatchObject({ ok: true, amount: 110, streak: 2 });
  });

  it('sells limited stock and refunds', async () => {
    await store.credit(guild, a, 1000, 'admin');
    const item = {
      itemId: 'vip',
      kind: 'giveaway',
      price: 100,
      stock: 1,
      perUser: null,
      ref: null,
      inventory: true,
      unique: false,
    };
    const bought = await store.purchase(guild, a, item);
    expect(bought.ok).toBe(true);
    expect(await store.purchase(guild, a, item)).toEqual({ ok: false, reason: 'sold_out' });
    expect(await store.giveawayEntries(guild, a, 'g1')).toBe(1);
    if (!bought.ok) return;
    const refunded = await store.refund(guild, bought.purchaseId, true);
    expect(refunded?.price).toBe(100);
    expect(await store.giveawayEntries(guild, a, 'g1')).toBe(0);
    expect((await store.soldCounts(guild)).get('vip')).toBe(0);
  });

  it('consumes giveaway entries once', async () => {
    await store.grantItem(guild, b, 'giveaway', null, 2);
    await store.grantItem(guild, c, 'giveaway', 'g2', 1);
    const used = await store.useGiveawayEntries(guild, 'g2');
    expect(used.get(b)).toBe(2);
    expect(used.get(c)).toBe(1);
    expect((await store.useGiveawayEntries(guild, 'g2')).size).toBe(0);
  });

  it('settles exchanges all or nothing', async () => {
    const poor = '400000000000000009';
    const ok = await store.exchange(guild, [
      { userId: a, delta: -10, kind: 'stake' },
      { userId: poor, delta: -10, kind: 'stake' },
      { userId: c, delta: 20, kind: 'payout' },
    ]);
    expect(ok).toBe(false);
    expect(await store.balance(guild, poor)).toBe(0);
  });

  it('ranks the richest and reports supply per day', async () => {
    const top = await store.richest(guild, 3);
    expect(top[0]?.userId).toBe(a);
    expect((await store.rank(guild, a))?.rank).toBe(1);
    const history = await store.supplyHistory(guild, 7);
    expect(history.at(-1)?.supply).toBe(await store.totalSupply(guild));
  });

  it('sums the overview and totals per kind for the dashboard', async () => {
    const d = '400000000000000004';
    const e = '400000000000000005';
    await store.credit(guild, d, 200, 'admin');
    expect((await store.transfer(guild, d, e, 100, 10)).ok).toBe(true);
    await store.earn(guild, e, 40, 'message', 40);
    const overview = await store.overview(guild, 40);
    expect(overview.supply).toBe(await store.totalSupply(guild));
    expect(overview.taxedMonth).toBeGreaterThanOrEqual(10);
    expect(overview.atCap).toBeGreaterThanOrEqual(1);
    expect(overview.wallets).toBeGreaterThan(0);
    const totals = await store.kindTotals(guild, 30);
    expect(totals.find((row) => row.kind === 'message')?.credited).toBeGreaterThanOrEqual(40);
    expect(await store.kindTotals(guild, 30, 'nothing')).toEqual([]);
  });
});
