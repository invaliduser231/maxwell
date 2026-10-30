import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/moderation';
import { APPEAL_WAIT_DAYS, InboxStore } from '@maxwell/core/stores/inbox';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('InboxStore', () => {
  let sql: Sql;
  let store: InboxStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const spammer = '340000000000000001';
  const lena = '340000000000000002';
  const tom = '340000000000000003';
  const mod = '340000000000000004';

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'moderation', migrations: definition.migrations },
    ]);
    store = new InboxStore(sql);
  });

  afterAll(async () => {
    await sql`delete from moderation_inbox where guild_id = ${guild}`;
    await sql.end();
  });

  it('groups reports about the same message', async () => {
    const input = {
      guildId: guild,
      subjectId: spammer,
      channelId: '1',
      messageId: '350000000000000001',
      excerpt: 'buy now',
    };
    const first = await store.report({ ...input, reporterId: lena, body: 'spam' });
    expect(first.kind).toBe('created');
    const second = await store.report({ ...input, reporterId: tom, body: 'scam link' });
    expect(second.kind).toBe('added');
    expect(second.item.number).toBe(first.item.number);
    expect(second.item.reporters).toEqual([lena, tom]);
    expect(second.item.body).toBe('spam\nscam link');
    const again = await store.report({ ...input, reporterId: tom, body: null });
    expect(again.kind).toBe('already');
  });

  it('opens a separate report for a member without a message', async () => {
    const result = await store.report({
      guildId: guild,
      subjectId: spammer,
      reporterId: lena,
      channelId: null,
      messageId: null,
      excerpt: null,
      body: 'DMs people',
    });
    expect(result.kind).toBe('created');
    expect(result.item.number).toBe(2);
  });

  it('claims, resolves and restores an item', async () => {
    const claimed = await store.assign(guild, 1, mod);
    expect(claimed?.after.status).toBe('claimed');
    expect(claimed?.after.assigneeId).toBe(mod);
    expect((await store.counts(guild, mod)).mine).toBe(1);

    const resolved = await store.resolve(guild, 1, {
      status: 'resolved',
      by: mod,
      outcome: 'timeout',
      outcomeCase: 7,
      note: null,
    });
    expect(resolved?.after.status).toBe('resolved');
    expect(resolved?.after.outcomeCase).toBe(7);
    expect(await store.resolve(guild, 1, { ...resolvedInput(), by: mod })).toBeNull();

    const restored = resolved ? await store.restore(guild, resolved.before) : null;
    expect(restored?.status).toBe('claimed');
    expect(restored?.resolvedAt).toBeNull();
    expect((await store.list(guild)).map((item) => item.number)).toEqual([2, 1]);
  });

  it('allows one appeal at a time and a new one only after the wait', async () => {
    const first = await store.appeal({
      guildId: guild,
      subjectId: spammer,
      body: 'sorry',
      caseNumber: 3,
    });
    expect(first.kind).toBe('created');
    const twice = await store.appeal({
      guildId: guild,
      subjectId: spammer,
      body: 'again',
      caseNumber: 3,
    });
    expect(twice.kind).toBe('open');
    if (first.kind !== 'created') return;
    await store.resolve(guild, first.item.number, {
      ...resolvedInput(),
      status: 'dismissed',
      by: mod,
    });
    const soon = await store.appeal({
      guildId: guild,
      subjectId: spammer,
      body: 'please',
      caseNumber: 3,
    });
    expect(soon.kind).toBe('wait');
    const later = await store.appeal(
      { guildId: guild, subjectId: spammer, body: 'please', caseNumber: 3 },
      Date.now() + (APPEAL_WAIT_DAYS + 1) * 86_400_000,
    );
    expect(later.kind).toBe('created');
  });

  it('creates one review per case', async () => {
    expect(await store.review(guild, spammer, 9, '7 warnings in 30 days')).not.toBeNull();
    expect(await store.review(guild, spammer, 9, '7 warnings in 30 days')).toBeNull();
    expect((await store.reviewFor(guild, 9))?.kind).toBe('review');
  });

  it('forgets a reporter and closed appeals', async () => {
    const before = await store.memberData(guild, lena);
    expect(before.reported.length).toBe(2);
    await store.forget(guild, lena);
    const after = await store.memberData(guild, lena);
    expect(after.reported).toEqual([]);

    await store.forget(guild, spammer);
    const appeals = await store.list(guild, { status: 'closed', kind: 'appeal' });
    expect(appeals).toEqual([]);
    expect((await store.list(guild, { kind: 'appeal' })).length).toBe(1);
  });
});

function resolvedInput() {
  return {
    status: 'resolved' as const,
    outcome: null,
    outcomeCase: null,
    note: null,
  };
}

describe.skipIf(!url)('InboxStore sources', () => {
  let sql: Sql;
  let store: InboxStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const member = '340000000000000011';

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'moderation', migrations: definition.migrations },
    ]);
    store = new InboxStore(sql);
  });

  afterAll(async () => {
    await sql`delete from moderation_inbox where guild_id = ${guild}`;
    await sql.end();
  });

  it('keeps one open gate item per community and updates it', async () => {
    const first = await store.openGate(guild, '3 members held');
    expect(first.created).toBe(true);
    expect(first.item.subjectId).toBeNull();
    const second = await store.openGate(guild, '7 members held');
    expect(second.created).toBe(false);
    expect(second.item.number).toBe(first.item.number);
    expect(second.item.body).toBe('7 members held');

    const closed = await store.closeGate(guild, 'let_in', null);
    expect(closed?.status).toBe('resolved');
    expect(await store.closeGate(guild, 'let_in', null)).toBeNull();
    expect((await store.openGate(guild, '1 member held')).created).toBe(true);
  });

  it('opens one item per security check and closes it by reference', async () => {
    const item = await store.openCheck(guild, member, '77', 'Risk score 80');
    expect(item?.refId).toBe('77');
    expect(await store.openCheck(guild, member, '77', 'Risk score 80')).toBeNull();
    const closed = await store.closeCheck(guild, '77', 'passed', null);
    expect(closed?.outcome).toBe('passed');
    expect(await store.closeCheck(guild, '77', 'passed', null)).toBeNull();
  });
});
