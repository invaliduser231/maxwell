import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/moderation';
import { ModerationStore } from '@maxwell/core/stores/moderation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('ModerationStore', () => {
  let sql: Sql;
  let store: ModerationStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const lena = '400000000000000001';
  const max = '400000000000000002';
  const mod = '400000000000000009';

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'moderation', migrations: definition.migrations },
    ]);
    store = new ModerationStore(sql);
  });

  afterAll(async () => {
    await sql`delete from moderation_cases where guild_id = ${guild}`;
    await sql`delete from moderation_counters where guild_id = ${guild}`;
    await sql`delete from moderation_notes where guild_id = ${guild}`;
    await sql`delete from moderation_names where guild_id = ${guild}`;
    await sql`delete from moderation_locks where guild_id = ${guild}`;
    await sql.end();
  });

  it('numbers cases per guild without gaps', async () => {
    const created = await Promise.all(
      [1, 2, 3].map(() =>
        store.create({
          guildId: guild,
          action: 'warn',
          userId: lena,
          moderatorId: mod,
          reason: 'spam',
        }),
      ),
    );
    expect(created.map((row) => row.number).sort()).toEqual([1, 2, 3]);
    const row = await store.get(guild, 2);
    expect(row?.userId).toBe(lena);
    expect(row?.moderatorId).toBe(mod);
    expect(row?.guildId).toBe(guild);
  });

  it('counts active warnings with expiry and window', async () => {
    expect(await store.activeWarns(guild, lena, 90)).toHaveLength(3);
    await sql`
      update moderation_cases set created_at = now() - interval '100 days'
      where guild_id = ${guild} and number = 1
    `;
    expect(await store.activeWarns(guild, lena, 90)).toHaveLength(2);
    expect(await store.activeWarns(guild, lena, null)).toHaveLength(3);
    expect(
      await store.activeWarns(guild, lena, null, new Date(Date.now() - 30 * 86_400_000)),
    ).toHaveLength(2);
  });

  it('voids and restores cases', async () => {
    expect(await store.voidCase(guild, 2, mod, 'mistake')).toBe(true);
    expect(await store.voidCase(guild, 2, mod, 'again')).toBe(false);
    expect(await store.activeWarns(guild, lena, 90)).toHaveLength(1);
    expect(await store.voidMany(guild, [2, 3], mod, null)).toEqual([3]);
    expect(await store.unvoid(guild, [2, 3])).toBe(2);
    expect(await store.activeWarns(guild, lena, 90)).toHaveLength(2);
  });

  it('edits reasons and claims unowned cases', async () => {
    const external = await store.create({
      guildId: guild,
      action: 'ban',
      userId: max,
      moderatorId: null,
    });
    const change = await store.setReason(guild, external.number, 'raid', mod);
    expect(change).toEqual({ before: null, claimed: true });
    expect((await store.get(guild, external.number))?.moderatorId).toBe(mod);
    await store.restoreReason(guild, external.number, null, true);
    const back = await store.get(guild, external.number);
    expect(back?.reason).toBeNull();
    expect(back?.moderatorId).toBeNull();
    expect(await store.setReason(guild, 9_999, 'x', mod)).toBeNull();
  });

  it('tracks open timed cases and overdue ones', async () => {
    const past = new Date(Date.now() - 60_000);
    const timed = await store.create({
      guildId: guild,
      action: 'timeout',
      userId: max,
      moderatorId: mod,
      durationSeconds: 60,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await store.openCase(guild, max, 'timeout'))?.number).toBe(timed.number);
    await sql`update moderation_cases set expires_at = ${past} where guild_id = ${guild} and number = ${timed.number}`;
    const overdue = await store.overdue(new Date());
    expect(overdue.some((row) => row.guildId === guild && row.number === timed.number)).toBe(true);
    expect(await store.end(guild, timed.number)).toBe(true);
    expect(await store.end(guild, timed.number)).toBe(false);
  });

  it('filters and searches the case list', async () => {
    expect((await store.list(guild, { action: 'warn' })).map((row) => row.number)).toEqual([
      3, 2, 1,
    ]);
    expect((await store.list(guild, { userId: max })).every((row) => row.userId === max)).toBe(
      true,
    );
    expect((await store.list(guild, { search: 'spam' })).length).toBe(3);
    expect((await store.list(guild, { search: max })).every((row) => row.userId === max)).toBe(
      true,
    );
    expect((await store.list(guild, { before: 3, limit: 1 })).map((row) => row.number)).toEqual([
      2,
    ]);
  });

  it('summarises a member', async () => {
    await store.addNote(guild, lena, mod, 'asked about the rules');
    await store.recordName(guild, lena, 'username', 'lena', null, true);
    await store.recordName(guild, lena, 'nick', 'L', null, false);
    const summary = await store.summary(guild, lena, 90);
    expect(summary).toMatchObject({ total: 3, activeWarns: 2, notes: 1, nameChanges: 1 });
    expect(summary.actions.warn).toBe(3);
    expect((await store.lastName(guild, lena, 'username'))?.value).toBe('lena');
    expect((await store.nameHistory(guild, lena)).map((row) => row.value)).toEqual(['L']);
  });

  it('numbers notes per community, also when they arrive together', async () => {
    const other = String(
      BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
    );
    const first = await store.addNote(other, lena, mod, 'first');
    expect(first.number).toBe(1);
    const batch = await Promise.all(
      [1, 2, 3, 4].map((n) => store.addNote(other, lena, mod, `note ${n}`)),
    );
    expect(batch.map((row) => row.number).sort()).toEqual([2, 3, 4, 5]);
    const third = batch.find((row) => row.number === 3);
    expect((await store.noteByNumber(other, 3))?.id).toBe(third?.id);
    expect(await store.noteByNumber(other, 0)).toBeNull();
    await sql`delete from moderation_notes where guild_id = ${other}`;
  });

  it('removes and restores notes', async () => {
    const note = await store.addNote(guild, max, mod, 'second account?');
    expect((await store.notes(guild, max)).map((row) => row.id)).toContain(note.id);
    expect((await store.noteByNumber(guild, note.number))?.id).toBe(note.id);
    expect(await store.deleteNote(guild, note.id)).toBe(true);
    expect(await store.noteByNumber(guild, note.number)).toBeNull();
    expect(await store.notes(guild, max)).toHaveLength(0);
    expect(await store.restoreNote(guild, note.id)).toBe(true);
    expect(await store.notes(guild, max)).toHaveLength(1);
  });

  it('keeps lock state per channel', async () => {
    const change = {
      id: guild,
      type: 'role' as const,
      before: null,
      after: { id: guild, type: 'role' as const, allow: [], deny: ['SendMessages'] },
    };
    await store.saveLock({
      guildId: guild,
      channelId: '500',
      changes: [change],
      moderatorId: mod,
      reason: null,
      endsAt: null,
    });
    expect((await store.lock(guild, '500'))?.changes).toEqual([change]);
    expect(await store.locks(guild)).toHaveLength(1);
    expect(await store.deleteLock(guild, '500')).toBe(true);
    expect(await store.lock(guild, '500')).toBeNull();
  });

  it('applies case retention', async () => {
    expect(await store.deleteBefore(guild, new Date(Date.now() - 50 * 86_400_000))).toBe(1);
    expect(await store.get(guild, 1)).toBeNull();
    expect(await store.guildsWithCases()).toContain(guild);
    const next = await store.create({
      guildId: guild,
      action: 'warn',
      userId: lena,
      moderatorId: mod,
    });
    expect(next.number).toBeGreaterThan(5);
  });
});
