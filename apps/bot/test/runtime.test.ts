import { AuditStore, connect, ModuleStore, migrate, type Sql } from '@maxwell/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';
import { Scheduler } from '../src/runtime/scheduler.js';
import { UndoRegistry } from '../src/runtime/undo.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('runtime', () => {
  let sql: Sql;
  let audit: AuditStore;
  let modules: ModuleStore;
  const log = createLogger('silent', false);
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const kai = { id: '300000000000000002' };

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, log);
    audit = new AuditStore(sql);
    modules = new ModuleStore(sql, audit);
  });

  afterAll(async () => {
    await sql`delete from jobs where guild_id = ${guild}`;
    await sql`delete from audit_entries where guild_id = ${guild}`;
    await sql`delete from guilds where id = ${guild}`;
    await sql.end();
  });

  it('runs due jobs through their handler', async () => {
    const scheduler = new Scheduler(sql, log);
    const seen: unknown[] = [];
    scheduler.handle('runtime.echo', async (job) => {
      seen.push(job.payload);
    });
    await scheduler.enqueue({ kind: 'runtime.echo', guildId: guild, payload: { n: 1 } });
    await scheduler.tick();
    expect(seen).toContainEqual({ n: 1 });
    const [left] =
      await sql`select 1 from jobs where guild_id = ${guild} and kind = 'runtime.echo'`;
    expect(left).toBeUndefined();
  });

  it('undoes a config change through the audit trail', async () => {
    const undo = new UndoRegistry(audit, modules);
    await modules.update(guild, 'invites', { logChannelId: '1' }, kai);
    await modules.update(guild, 'invites', { logChannelId: '2' }, kai);
    const [latest] = await audit.list(guild, { module: 'invites' });
    expect(await undo.undo(guild, latest?.id ?? '', kai)).toBe('done');
    expect((await modules.state(guild, 'invites')).config).toEqual({ logChannelId: '1' });
    expect(await undo.undo(guild, latest?.id ?? '', kai)).toBe('expired');
  });

  it('undoes a module switch', async () => {
    const undo = new UndoRegistry(audit, modules);
    await modules.setEnabled(guild, 'starboard', true, kai);
    const [entry] = await audit.list(guild, { module: 'starboard' });
    expect(await undo.undo(guild, entry?.id ?? '', kai)).toBe('done');
    expect(await modules.isEnabled(guild, 'starboard')).toBe(false);
  });
});
