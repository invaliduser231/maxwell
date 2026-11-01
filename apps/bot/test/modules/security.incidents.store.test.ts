import { connect, migrate, RetentionStore, type Sql } from '@maxwell/core';
import automod from '@maxwell/core/modules/automod';
import definition from '@maxwell/core/modules/security';
import { IncidentStore } from '@maxwell/core/stores/incidents';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('IncidentStore', () => {
  let sql: Sql;
  let store: IncidentStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const user = String(BigInt(guild) + 7n);

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'automod', migrations: automod.migrations },
      { module: 'security', migrations: definition.migrations },
    ]);
    store = new IncidentStore(sql);
  });

  afterAll(async () => {
    await sql`delete from security_incidents where guild_id = ${guild}`;
    await sql`delete from automod_hits where guild_id = ${guild}`;
    await sql.end();
  });

  it('keeps one open incident per community and extends it', async () => {
    const endsAt = new Date(Date.now() + 60_000);
    const first = await store.open({ guildId: guild, kind: 'nuke', startedBy: null, endsAt });
    expect(first.created).toBe(true);
    const later = new Date(endsAt.getTime() + 60_000);
    const second = await store.open({
      guildId: guild,
      kind: 'raid',
      raidId: '5',
      startedBy: null,
      endsAt: later,
    });
    expect(second.created).toBe(false);
    expect(second.incident.id).toBe(first.incident.id);
    expect(second.incident.kind).toBe('nuke');
    expect(second.incident.raidId).toBe('5');
    expect(second.incident.endsAt?.getTime()).toBe(later.getTime());
    expect((await store.active(guild))?.id).toBe(first.incident.id);
  });

  it('merges events on the same target and counts deletions', async () => {
    const incident = await store.active(guild);
    if (!incident) throw new Error('no incident');
    await store.add(incident, { kind: 'ban', userId: user, targetId: user, detail: { name: 'x' } });
    await store.add(incident, { kind: 'ban', userId: user, targetId: user, byMaxwell: true });
    await store.add(incident, { kind: 'join', userId: user, targetId: user });
    await store.deleted(incident, 3);
    await store.deleted(incident, 4);
    await sql`
      insert into automod_hits (guild_id, user_id, rule, mode, detail, content)
      values (${guild}, ${user}, 'links', 'enforce', '', 'secret text')
    `;
    const events = await store.events(incident);
    const bans = events.filter((event) => event.kind === 'ban');
    expect(bans).toHaveLength(1);
    expect(bans[0]).toMatchObject({ byMaxwell: true, detail: { name: 'x' } });
    expect(events.find((event) => event.kind === 'delete')?.count).toBe(7);
    const hit = events.find((event) => event.kind === 'hit');
    expect(hit?.detail).toEqual({ rule: 'links', action: null });
    const [listed] = await store.list(guild);
    expect(listed?.tally).toMatchObject({ bans: 1, joins: 1, deleted: 7, hits: 1 });
  });

  it('forgets members and closes', async () => {
    const incident = await store.active(guild);
    if (!incident) throw new Error('no incident');
    expect(await store.memberData(guild, user)).toHaveLength(2);
    await store.forgetMember(guild, user);
    expect(await store.memberData(guild, user)).toHaveLength(0);
    const closed = await store.close(guild, incident.id, null);
    expect(closed?.endedAt).not.toBeNull();
    expect(await store.active(guild)).toBeNull();
    await store.markUndone(guild, incident.id, user);
    expect((await store.get(guild, incident.id))?.undoneBy).toBe(user);
  });

  it('is removed by the retention job after 90 days', async () => {
    await sql`
      update security_incidents set started_at = now() - interval '100 days',
        ended_at = now() - interval '95 days'
      where guild_id = ${guild}
    `;
    const removed = await new RetentionStore(sql).pruneIncidents(
      new Date(Date.now() - 90 * 86_400_000),
    );
    expect(removed).toBeGreaterThanOrEqual(1);
    const [left] = await sql<{ n: number }[]>`
      select count(*)::int as n from security_incident_events where guild_id = ${guild}
    `;
    expect(left?.n).toBe(0);
  });
});
