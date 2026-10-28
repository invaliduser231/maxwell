import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/automod';
import { AutomodStore, type StoredMessage } from '@maxwell/core/stores/automod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';
import { DryRunner, parseRule, replayGuild } from '../../src/modules/automod/dryrun.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('AutomodStore', () => {
  let sql: Sql;
  let store: AutomodStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const user = '300000000000000001';
  const channel = '400000000000000001';

  function message(id: number, content: string, minutesAgo: number): StoredMessage {
    return {
      guildId: guild,
      messageId: String(500000000000000000n + BigInt(id)),
      channelId: channel,
      authorId: user,
      authorRoles: id % 2 === 0 ? ['600000000000000001'] : [],
      authorBot: false,
      content,
      mentionUsers: 0,
      mentionRoles: 0,
      createdAt: new Date(Date.now() - minutesAgo * 60_000),
    };
  }

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'automod', migrations: definition.migrations },
    ]);
    store = new AutomodStore(sql);
  });

  afterAll(async () => {
    await sql`delete from automod_hits where guild_id = ${guild}`;
    await sql`delete from automod_messages where guild_id = ${guild}`;
    await sql`delete from automod_dryruns where guild_id = ${guild}`;
    await sql`delete from automod_held where guild_id = ${guild}`;
    await sql`delete from automod_incidents where guild_id = ${guild}`;
    await sql.end();
  });

  it('records hits for the member file', async () => {
    await store.recordHits([
      {
        guildId: guild,
        userId: user,
        channelId: channel,
        messageId: '500000000000000001',
        rule: 'caps',
        mode: 'enforce',
        action: 'delete',
        detail: '90% capitals',
        content: 'LOUD',
      },
      {
        guildId: guild,
        userId: user,
        channelId: channel,
        messageId: '500000000000000002',
        rule: 'spam',
        mode: 'log',
        action: null,
        detail: '6 messages in 5s',
        content: null,
      },
    ]);
    const hits = await store.hitsForMember(guild, user);
    expect(hits.map((hit) => hit.rule).sort()).toEqual(['caps', 'spam']);
    expect(hits.find((hit) => hit.rule === 'spam')?.action).toBeNull();
    const counts = await store.hitCounts(guild, new Date(Date.now() - 60_000));
    expect(counts).toHaveLength(2);
    expect((await store.recentHits(guild, { rule: 'caps' }))[0]?.detail).toBe('90% capitals');
  });

  it('stores, edits and replays recent messages in order', async () => {
    await store.saveMessages([
      message(1, 'first', 30),
      message(2, 'second', 20),
      message(3, 'third', 10),
      message(4, 'old', 60 * 24 * 8),
    ]);
    await store.saveMessages([message(1, 'duplicate', 30)]);
    await store.editMessage(guild, String(500000000000000003n), 'third, edited');

    const since = new Date(Date.now() - 7 * 86_400_000);
    const first = await store.replay(guild, since, null, 2);
    expect(first.map((row) => row.content)).toEqual(['first', 'second']);
    expect(first[1]?.authorRoles).toEqual(['600000000000000001']);
    const last = first[1];
    const rest = last
      ? await store.replay(
          guild,
          since,
          { createdAt: last.createdAt, messageId: last.messageId },
          2,
        )
      : [];
    expect(rest.map((row) => row.content)).toEqual(['third, edited']);
  });

  it('runs a dry run against the stored history', async () => {
    const parsed = parseRule('words', { patterns: ['*ir*'] });
    if (!parsed) throw new Error('rule did not parse');
    const runId = await store.createDryRun(guild, parsed.key, parsed.rule, user);
    await store.startDryRun(guild, runId);
    const runner = new DryRunner(
      parsed.key,
      parsed.rule,
      { exemptChannelIds: [], exemptRoleIds: [], ignoreBots: true },
      new Set(['600000000000000001']),
      new Map(),
    );
    const result = await replayGuild(store, guild, runner);
    await store.finishDryRun(guild, runId, result);
    const run = await store.getDryRun(guild, runId);
    expect(run).toMatchObject({ status: 'done', scanned: 3, caught: 2, byMods: 0 });
    expect(run?.samples.map((sample) => sample.content)).toEqual(['first', 'third, edited']);
    expect((await store.listDryRuns(guild))[0]?.id).toBe(runId);
  });

  it('rotates old days away and trims busy communities', async () => {
    await store.rotateMessages(7);
    expect(await store.messageCount(guild)).toBe(3);
    const trimmed = await store.trimMessages(2, new Date(Date.now() - 3_600_000));
    expect(trimmed).toBeGreaterThanOrEqual(1);
    expect(await store.messageCount(guild)).toBe(2);
    expect(await store.messageGuilds()).toContain(guild);
    expect(await store.dropMessages(guild)).toBe(2);
    expect(await store.messageGuilds()).not.toContain(guild);
  });

  it('keeps day partitions for the history window only', async () => {
    const [today] = await sql<{ name: string }[]>`
      select 'automod_messages_p' || to_char((now() at time zone 'utc')::date, 'YYYYMMDD') as name
    `;
    const parts = await sql<{ name: string }[]>`
      select c.relname as name from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
      join pg_class p on p.oid = i.inhparent
      where p.relname = 'automod_messages' and c.relname ~ '^automod_messages_p[0-9]{8}$'
    `;
    expect(parts.map((part) => part.name)).toContain(today?.name);
    expect(parts.length).toBe(10);
    await sql.unsafe(
      'create table automod_messages_p20000101 (like automod_messages including defaults)',
    );
    await sql.unsafe(
      "alter table automod_messages attach partition automod_messages_p20000101 for values from ('2000-01-01 00:00+00') to ('2000-01-02 00:00+00')",
    );
    expect(await store.rotateMessages(7)).toBe(1);
  });

  it('tracks incidents and members held at the gate', async () => {
    const endsAt = new Date(Date.now() + 15 * 60_000);
    const incident = await store.startIncident(guild, 'raid', null, endsAt);
    expect(await store.hold(guild, '300000000000000010', incident.id, 'raid')).toBe(true);
    expect(await store.hold(guild, '300000000000000010', incident.id, 'raid')).toBe(false);
    expect(await store.hold(guild, '300000000000000011', incident.id, 'lockdown')).toBe(true);
    expect(await store.hold(guild, '300000000000000012', null, 'account_age')).toBe(true);

    const active = await store.activeIncident(guild);
    expect(active).toMatchObject({ id: incident.id, held: 2 });
    expect(await store.isHeld(guild, '300000000000000012')).toBe(true);

    const resolved = await store.resolveHeld(guild, ['300000000000000010'], 'let_in', user);
    expect(resolved).toEqual(['300000000000000010']);
    expect((await store.held(guild)).map((row) => row.userId).sort()).toEqual([
      '300000000000000011',
      '300000000000000012',
    ]);
    expect(await store.held(guild, incident.id)).toHaveLength(1);
    expect(await store.hold(guild, '300000000000000010', null, 'lockdown')).toBe(true);

    expect(await store.endIncident(guild, incident.id, user)).toBe(true);
    expect(await store.endIncident(guild, incident.id, user)).toBe(false);
    expect(await store.activeIncident(guild)).toBeNull();
    const [listed] = await store.incidents(guild);
    expect(listed?.held).toBe(2);
  });

  it('exports and forgets one member without touching others', async () => {
    const target = '300000000000000020';
    const other = '300000000000000021';
    const hit = (userId: string, messageId: string) => ({
      guildId: guild,
      userId,
      channelId: channel,
      messageId,
      rule: 'caps',
      mode: 'enforce',
      action: 'warn',
      detail: '90% capitals',
      content: 'SHOUT',
    });
    await store.recordHits([hit(target, '510000000000000001'), hit(other, '510000000000000002')]);
    await store.saveMessages([
      { ...message(30, 'mine', 1), authorId: target },
      { ...message(31, 'theirs', 1), authorId: other },
    ]);
    await store.hold(guild, target, null, 'account_age');
    await store.resolveHeld(guild, [target], 'let_in', user);
    await store.hold(guild, target, null, 'lockdown');
    const runId = await store.createDryRun(guild, 'caps', {}, target);
    await store.finishDryRun(guild, runId, {
      scanned: 2,
      caught: 2,
      byMods: 0,
      samples: [
        {
          messageId: '1',
          channelId: channel,
          authorId: target,
          content: 'mine',
          detail: 'x',
          byMod: false,
          createdAt: new Date().toISOString(),
        },
        {
          messageId: '2',
          channelId: channel,
          authorId: other,
          content: 'theirs',
          detail: 'x',
          byMod: false,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const exported = await store.memberData(guild, target);
    expect(exported).toMatchObject({
      hits: [{ rule: 'caps', content: 'SHOUT' }],
      storedMessages: [{ content: 'mine' }],
      dryRunSamples: [{ dryRunId: runId, content: 'mine' }],
    });
    expect(exported?.gateHolds).toHaveLength(2);

    await store.forgetMember(guild, target);
    expect(await store.hitsForMember(guild, target)).toEqual([]);
    expect(await store.hitsForMember(guild, other)).toHaveLength(1);
    const left = await store.memberData(guild, target);
    expect(left).toMatchObject({ hits: [], storedMessages: [], dryRunSamples: [] });
    expect(left?.gateHolds).toHaveLength(1);
    expect(await store.isHeld(guild, target)).toBe(true);
    const run = await store.getDryRun(guild, runId);
    expect(run?.samples.map((sample) => sample.content)).toEqual(['theirs']);
    expect(run?.requestedBy).toBeNull();
    expect(await store.memberData(guild, '300000000000000099')).toBeNull();
  });
});
