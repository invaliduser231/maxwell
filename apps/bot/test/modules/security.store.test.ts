import { connect, migrate, type Sql } from '@maxwell/core';
import moderation from '@maxwell/core/modules/moderation';
import definition from '@maxwell/core/modules/security';
import { SecurityStore } from '@maxwell/core/stores/security';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('SecurityStore', () => {
  let sql: Sql;
  let store: SecurityStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const user = String(BigInt(guild) + 7n);

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'moderation', migrations: moderation.migrations },
      { module: 'security', migrations: definition.migrations },
    ]);
    store = new SecurityStore(sql);
  });

  afterAll(async () => {
    await sql`delete from security_checks where guild_id = ${guild}`;
    await sql`delete from security_events where guild_id = ${guild}`;
    await sql`delete from security_raids where guild_id = ${guild}`;
    await sql.end();
  });

  it('keeps one open check per member and counts outcomes', async () => {
    const reasons = [{ key: 'age', hours: 24 }, { key: 'noAvatar' }];
    const first = await store.openCheck({
      guildId: guild,
      userId: user,
      score: 7,
      reasons,
      status: 'pending',
      method: null,
      code: '12345',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(first.reasons).toEqual(reasons);
    const second = await store.openCheck({
      guildId: guild,
      userId: user,
      score: 8,
      reasons: [],
      status: 'pending',
      method: 'dm',
      code: '54321',
      expiresAt: null,
    });
    expect((await store.check(guild, first.id))?.status).toBe('released');
    expect((await store.pending(guild, user))?.id).toBe(second.id);
    expect((await store.pendingFor(user)).map((check) => check.id)).toEqual([second.id]);

    expect(await store.attempt(second.id)).toBe(1);
    await store.setLog(second.id, '1', '2');
    const passed = await store.resolve(second.id, 'passed');
    expect(passed).toMatchObject({ status: 'passed', logChannelId: '1', logMessageId: '2' });
    expect(await store.resolve(second.id, 'failed')).toBeNull();

    const counts = await store.counts(guild, new Date(Date.now() - 60_000));
    expect(counts).toMatchObject({ checked: 2, passed: 1, pending: 0 });
  });

  it('starts, extends and ends one raid at a time', async () => {
    const soon = new Date(Date.now() + 60_000);
    const later = new Date(Date.now() + 120_000);
    const started = await store.startRaid(guild, 'joins', null, soon);
    expect(started.created).toBe(true);
    const again = await store.startRaid(guild, 'wave', null, later);
    expect(again.created).toBe(false);
    expect(again.raid.id).toBe(started.raid.id);
    expect(again.raid.endsAt?.getTime()).toBe(later.getTime());
    await store.setRaidState(started.raid.id, { pausedInvites: true });
    const ended = await store.endRaid(guild, '9');
    expect(ended?.state).toEqual({ pausedInvites: true });
    expect(await store.activeRaid(guild)).toBeNull();
  });

  it('logs events and forgets members', async () => {
    await store.event({
      guildId: guild,
      kind: 'honeypot',
      userId: user,
      actorId: null,
      summary: 'softban',
      detail: { channelId: '1' },
    });
    expect((await store.events(guild, 10, 'honeypot')).length).toBe(1);
    expect(await store.memberData(guild, user)).not.toBeNull();
    await store.forgetMember(guild, user);
    const events = await store.events(guild, 10);
    expect(events.every((event) => event.userId === null)).toBe(true);
    expect(await store.history(guild, user)).toEqual({ kicks: 0, bans: 0, leftAt: null });
  });
});
