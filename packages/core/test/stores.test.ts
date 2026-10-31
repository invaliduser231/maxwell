import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditStore, canUndo } from '../src/audit/store.js';
import { migrate } from '../src/db/migrate.js';
import { connect, type Sql } from '../src/db/sql.js';
import { ModuleStore } from '../src/guilds/modules.js';
import { claim, complete, enqueue, fail } from '../src/jobs/queue.js';
import { silentLogger } from '../src/log.js';
import { catalog, moduleByKey, voteLockedKeys } from '../src/modules/catalog.js';
import { extractVoterIds, Votes } from '../src/votes/votes.js';

describe('catalog', () => {
  it('has unique keys and every module has a config schema with defaults', () => {
    const keys = catalog.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const definition of catalog) expect(() => definition.config.parse({})).not.toThrow();
  });

  it('locks the right modules behind a vote', () => {
    expect([...voteLockedKeys].sort()).toEqual(
      ['backups', 'collection', 'commands', 'economy', 'feeds', 'forms', 'insights'].sort(),
    );
    expect(moduleByKey('moderation')?.voteLocked).toBe(false);
  });
});

describe('extractVoterIds', () => {
  it('reads ids as numbers or strings', () => {
    expect(extractVoterIds('{"voters":[{"fluxerId":"123"},{"fluxerId":456}]}')).toEqual([
      '123',
      '456',
    ]);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('stores', () => {
  let sql: Sql;
  let audit: AuditStore;
  let modules: ModuleStore;
  const guild = String(BigInt(Date.now()) * 1000n + 11n);
  const lena = { id: '300000000000000001' };

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, silentLogger);
    audit = new AuditStore(sql);
    modules = new ModuleStore(sql, audit);
  });

  afterAll(async () => {
    await sql`delete from audit_entries where guild_id = ${guild}`;
    await sql`delete from jobs where guild_id = ${guild}`;
    await sql`delete from guilds where id = ${guild}`;
    await sql.end();
  });

  it('falls back to the catalog default', async () => {
    expect((await modules.state(guild, 'invites')).enabled).toBe(true);
    expect((await modules.state(guild, 'levels')).enabled).toBe(false);
    expect((await modules.state(guild, 'general')).enabled).toBe(true);
  });

  it('records config changes with before and after', async () => {
    await modules.update(guild, 'invites', { logChannelId: '400000000000000001' }, lena);
    await modules.update(guild, 'invites', { logChannelId: '400000000000000002' }, lena);
    const [latest] = await audit.list(guild, { module: 'invites' });
    expect(latest?.before).toEqual({ logChannelId: '400000000000000001' });
    expect(latest?.after).toEqual({ logChannelId: '400000000000000002' });
    expect(latest?.actorId).toBe(lena.id);
    expect(latest && canUndo(latest)).toBe(true);
    expect(latest?.undo).toEqual({
      kind: 'module.config',
      payload: { module: 'invites', config: { logChannelId: '400000000000000001' } },
    });
  });

  it('merges quick saves by the same person into one entry', async () => {
    const minute = 60_000;
    const max = { id: '300000000000000002' };
    await modules.update(guild, 'starboard', { threshold: 4 }, lena, undefined, {
      mergeWithin: minute,
    });
    await modules.update(guild, 'starboard', { threshold: 5, selfStar: true }, lena, undefined, {
      mergeWithin: minute,
    });
    let entries = await audit.list(guild, { module: 'starboard' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.before).toEqual({ threshold: null, selfStar: null });
    expect(entries[0]?.after).toEqual({ threshold: 5, selfStar: true });
    expect(entries[0]?.undo?.payload).toEqual({ module: 'starboard', config: {} });

    await modules.update(guild, 'starboard', { threshold: 6 }, max, undefined, {
      mergeWithin: minute,
    });
    entries = await audit.list(guild, { module: 'starboard' });
    expect(entries).toHaveLength(2);

    await modules.update(guild, 'starboard', { threshold: 5 }, max, undefined, {
      mergeWithin: minute,
    });
    entries = await audit.list(guild, { module: 'starboard' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actorId).toBe(lena.id);
  });

  it('turns modules on and off with an audit entry', async () => {
    await modules.setEnabled(guild, 'levels', true, lena);
    expect(await modules.isEnabled(guild, 'levels')).toBe(true);
    const [entry] = await audit.list(guild, { module: 'levels' });
    expect(entry?.action).toBe('module.enable');
    expect(await audit.markUndone(guild, entry?.id ?? '', lena)).toBe(true);
    expect(await audit.markUndone(guild, entry?.id ?? '', lena)).toBe(false);
  });

  it('claims due jobs once and retries failures later', async () => {
    const key = `test-${guild}`;
    const kinds = ['test.run', 'test.later'];
    await enqueue(sql, { kind: 'test.run', guildId: guild, dedupeKey: key });
    expect(await enqueue(sql, { kind: 'test.run', guildId: guild, dedupeKey: key })).toBeNull();
    await enqueue(sql, {
      kind: 'test.later',
      guildId: guild,
      runAt: new Date(Date.now() + 3_600_000),
    });

    const first = (await claim(sql, 50, 60, kinds)).filter((job) => job.guildId === guild);
    expect(first.map((job) => job.kind)).toEqual(['test.run']);
    expect((await claim(sql, 50, 60, kinds)).filter((job) => job.guildId === guild)).toEqual([]);

    const job = first[0];
    if (!job) throw new Error('no job');
    const next = await enqueue(sql, { kind: 'test.next', guildId: guild, dedupeKey: key });
    expect(next).not.toBeNull();
    await fail(sql, job.id, 'boom', new Date(Date.now() - 1000));
    const retried = (await claim(sql, 50, 60, kinds)).filter((j) => j.guildId === guild);
    expect(retried[0]?.attempts).toBe(2);
    await complete(sql, job.id);
  });

  it('stores voters for good', async () => {
    const votes = new Votes(sql, null, silentLogger);
    const id = `9${Date.now()}`;
    expect(await votes.hasVoted(id)).toBe(false);
    expect(await votes.add([id, id])).toBe(1);
    expect(await votes.check(id)).toBe(true);
    await sql`delete from voters where user_id = ${id}`;
  });
});
