import { connect, migrate, RetentionStore, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/security';
import { ShieldStore } from '@maxwell/core/stores/shield';
import { ShieldDisputeStore } from '@maxwell/core/stores/shield-disputes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';
import { disputeMessage } from '../../src/modules/security/disputes.js';

const url = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;

describe('disputeMessage', () => {
  it('tells the outcome, the note and where to look', () => {
    const kept = disputeMessage('kept', 'Two communities confirmed it.', 'https://maxwell.test/');
    expect(kept).toContain('declined');
    expect(kept).toContain('Note: Two communities confirmed it.');
    expect(kept).toContain('https://maxwell.test/shield');
    expect(disputeMessage('removed', null, undefined)).toBe(
      'Your Maxwell Shield dispute was accepted. You are no longer listed.',
    );
  });
});

describe.skipIf(!url)('ShieldDisputeStore', () => {
  let sql: Sql;
  let shield: ShieldStore;
  let store: ShieldDisputeStore;
  const base = BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));
  const a = String(base);
  const b = String(base + 1n);
  const user = String(base + 10n);
  const clean = String(base + 11n);
  const operator = '370000000000000001';
  const body = 'I was not part of any raid and never posted there.';

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'security', migrations: definition.migrations },
    ]);
    shield = new ShieldStore(sql);
    store = new ShieldDisputeStore(sql);
    await sql`insert into guilds (id) values (${a}), (${b})`;
    for (const guildId of [a, b]) {
      await sql`
        insert into guild_modules (guild_id, module, enabled, config)
        values (${guildId}, 'security', true, ${sql.json({ shield: { enabled: true } })})
      `;
    }
    await shield.report(a, user, 'raid', null);
    await shield.report(b, user, 'manual', operator);
  });

  afterAll(async () => {
    await sql`delete from security_shield_disputes where user_id in (${user}, ${clean})`;
    await sql`delete from security_shield_reports where guild_id in (${a}, ${b})`;
    await sql`delete from guild_modules where guild_id in (${a}, ${b})`;
    await sql`delete from guilds where id in (${a}, ${b})`;
    await sql.end();
  });

  it('shows the listing without the communities', async () => {
    const listing = await store.listing(user);
    expect(listing).toHaveLength(2);
    expect(listing.map((entry) => entry.source).sort()).toEqual(['manual', 'raid']);
    expect(Object.keys(listing[0] ?? {}).sort()).toEqual(['createdAt', 'expiresAt', 'source']);
  });

  it('files one open dispute per user', async () => {
    expect((await store.file(clean, body)).kind).toBe('not-listed');
    const first = await store.file(user, body);
    expect(first.kind).toBe('created');
    expect((await store.file(user, body)).kind).toBe('open');
    expect(await store.open()).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: user, status: 'open' })]),
    );
  });

  it('keeps a listing with a note and makes the user wait', async () => {
    const dispute = await store.latest(user);
    expect(dispute).not.toBeNull();
    const id = dispute?.id ?? '';
    expect((await store.decide(id, operator, 'keep', null)).kind).toBe('note');
    const kept = await store.decide(id, operator, 'keep', 'Two communities confirmed it.');
    expect(kept.kind).toBe('decided');
    expect((await store.decide(id, operator, 'remove', null)).kind).toBe('closed');
    expect(await store.listing(user)).toHaveLength(2);
    expect((await store.file(user, body)).kind).toBe('wait');
    const [log] = await store.decisions(1);
    expect(log).toMatchObject({ disputeId: id, action: 'kept', operatorId: operator });
    expect(log?.records).toHaveLength(2);
  });

  it('removes the listing and records the removed entries', async () => {
    const later = Date.now() + 31 * DAY;
    const filed = await store.file(user, body, later);
    expect(filed.kind).toBe('created');
    if (filed.kind !== 'created') return;
    const removed = await store.decide(filed.dispute.id, operator, 'remove', null, later);
    expect(removed).toMatchObject({ kind: 'decided', removed: 2 });
    expect(await store.listing(user, later)).toHaveLength(0);
    const [log] = await store.decisions(1);
    expect(log?.action).toBe('removed');
    expect(log?.records.map((record) => record.guildId).sort()).toEqual([a, b].sort());
  });

  it('deletes closed disputes after the retention time', async () => {
    const retention = new RetentionStore(sql);
    await sql`
      update security_shield_disputes set decided_at = ${new Date('2000-01-01T00:00:00Z')}
      where user_id = ${user}
    `;
    expect(await retention.pruneDisputes(new Date('2001-01-01T00:00:00Z'))).toBeGreaterThanOrEqual(
      2,
    );
    expect(await store.latest(user)).toBeNull();
    const [left] = await sql<{ n: number }[]>`
      select count(*)::int as n from security_shield_decisions where user_id = ${user}
    `;
    expect(left?.n).toBe(0);
  });
});
