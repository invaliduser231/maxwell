import { connect, migrate, type Sql } from '@maxwell/core';
import definition, { type SnapshotData } from '@maxwell/core/modules/backups';
import { BackupStore } from '@maxwell/core/stores/backups';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';
import {
  applyImport,
  type ImportResult,
  previewImport,
} from '../../src/modules/backups/importer.js';
import type { ChannelInput, Platform, RoleEdit, RoleInput } from '../../src/platform/types.js';

const url = process.env.TEST_DATABASE_URL;

function data(roleName: string, channelName: string): SnapshotData {
  return {
    version: 1,
    roles: [
      {
        id: '11',
        name: roleName,
        color: 0,
        position: 1,
        permissions: '0',
        hoist: null,
        mentionable: null,
      },
    ],
    channels: [
      {
        id: '21',
        name: channelName,
        type: 0,
        parentId: null,
        position: 0,
        topic: null,
        userLimit: null,
        nsfw: null,
        overwrites: null,
      },
    ],
    modules: { invites: { enabled: true, config: { logChannelId: '21' } } },
  };
}

describe.skipIf(!url)('BackupStore', () => {
  let sql: Sql;
  let store: BackupStore;
  const randomId = () =>
    String(BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)));
  const guild = randomId();
  const user = '300000000000000001';

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'backups', migrations: definition.migrations },
    ]);
    store = new BackupStore(sql);
  });

  afterAll(async () => {
    await sql`delete from backups_snapshots where guild_id = ${guild}`;
    await sql`delete from backups_imports where guild_id = ${guild}`;
    await sql`delete from guilds where id = ${guild}`;
    await sql.end();
  });

  it('saves, lists and loads snapshots', async () => {
    const first = await store.insert(guild, 'daily', data('Old name', 'general'));
    const second = await store.insert(guild, 'manual', data('New name', 'chat'), {
      label: 'before event',
      by: user,
    });
    expect(second).toMatchObject({ kind: 'manual', roleCount: 1, channelCount: 1, moduleCount: 1 });
    expect([first.number, second.number]).toEqual([1, 2]);
    expect((await store.byNumber(guild, 2))?.id).toBe(second.id);
    expect((await store.byNumber(guild, 2))?.data.roles[0]?.name).toBe('New name');
    expect(await store.byNumber(guild, 0)).toBeNull();
    const list = await store.list(guild);
    expect(list.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(list[0]?.label).toBe('before event');
    expect((await store.get(guild, first.id))?.data.roles[0]?.name).toBe('Old name');
    expect(await store.get(guild, 'nope')).toBeNull();
    expect((await store.latest(guild))?.id).toBe(second.id);
    expect((await store.latest(guild, 'daily'))?.id).toBe(first.id);
    expect(await store.latestAt(guild, 'daily')).toBeInstanceOf(Date);
    const usage = await store.usage(guild);
    expect(usage.count).toBe(2);
    expect(usage.bytes).toBeGreaterThan(0);
    expect(await store.usage('1')).toEqual({ count: 0, bytes: 0 });
  });

  it('numbers snapshots per community, also when they arrive together', async () => {
    const other = randomId();
    const first = await store.insert(other, 'manual', data('a', 'b'));
    expect(first.number).toBe(1);
    const batch = await Promise.all(
      [1, 2, 3, 4].map((n) => store.insert(other, 'daily', data(`r${n}`, `c${n}`))),
    );
    expect(batch.map((row) => row.number).sort()).toEqual([2, 3, 4, 5]);
    const third = batch.find((row) => row.number === 3);
    expect((await store.byNumber(other, 3))?.id).toBe(third?.id);
    expect(await store.byNumber(other, 6)).toBeNull();
    const elsewhere = randomId();
    expect((await store.insert(elsewhere, 'manual', data('a', 'b'))).number).toBe(1);
    await sql`delete from backups_snapshots where guild_id in (${other}, ${elsewhere})`;
  });

  it('finds the latest copy of a role or channel', async () => {
    expect((await store.findRole(guild, '11'))?.role.name).toBe('New name');
    expect((await store.findChannel(guild, '21'))?.channel.name).toBe('chat');
    expect(await store.findRole(guild, '999')).toBeNull();
  });

  it('prunes old daily and surplus manual snapshots', async () => {
    const old = await store.insert(guild, 'daily', data('x', 'y'));
    await sql`update backups_snapshots set created_at = now() - interval '40 days' where id = ${old.id}`;
    await store.insert(guild, 'manual', data('x', 'y'));
    await store.insert(guild, 'manual', data('x', 'y'));
    const removed = await store.prune(guild, { retentionDays: 14, maxManual: 2 });
    expect(removed).toBe(2);
    const kinds = (await store.list(guild)).map((row) => row.kind).sort();
    expect(kinds).toEqual(['daily', 'manual', 'manual']);
  });

  it('keeps the newest daily snapshot even when it is old', async () => {
    await sql`update backups_snapshots set created_at = now() - interval '60 days' where guild_id = ${guild} and kind = 'daily'`;
    await store.prune(guild, { retentionDays: 14, maxManual: 2 });
    expect((await store.list(guild)).filter((row) => row.kind === 'daily')).toHaveLength(1);
  });

  it('reads and writes module states', async () => {
    await store.writeModuleStates(
      guild,
      {
        invites: { enabled: true, config: { logChannelId: '5' } },
        backups: { enabled: false, config: { daily: false } },
      },
      ['backups'],
    );
    const states = await store.moduleStates(guild);
    expect(states.invites).toEqual({ enabled: true, config: { logChannelId: '5' } });
    expect(states.backups).toEqual({ enabled: null, config: { daily: false } });
  });

  it('previews and applies a template import once', async () => {
    const created: { roles: RoleInput[]; channels: (ChannelInput & { id: string })[] } = {
      roles: [],
      channels: [],
    };
    let next = 5000;
    const speak = String(1n << 21n);
    const everyoneBefore = String((1n << 21n) | (1n << 10n));
    const roleEdits: { id: string; edit: RoleEdit }[] = [];
    const platform = {
      roles: async () => [
        {
          id: guild,
          name: '@everyone',
          color: 0,
          position: 0,
          permissions: everyoneBefore,
          managed: false,
          hoist: false,
          mentionable: false,
        },
      ],
      editRole: async (_guild: string, id: string, edit: RoleEdit) => {
        roleEdits.push({ id, edit });
      },
      channels: async () => [],
      createRole: async (_guild: string, input: RoleInput) => {
        created.roles.push(input);
        return String(next++);
      },
      createChannel: async (_guild: string, input: ChannelInput) => {
        const id = String(next++);
        created.channels.push({ ...input, id });
        return id;
      },
    } as unknown as Platform;
    const recorded: ImportResult[] = [];
    const deps = {
      platform,
      store,
      fetcher: (async () =>
        new Response(
          JSON.stringify({
            code: 'tmpl',
            name: 'Club',
            serialized_source_guild: {
              roles: [
                { id: 0, name: '@everyone', permissions: '0' },
                { id: 1, name: 'Crew', permissions: String(1n << 13n) },
              ],
              channels: [
                { id: 2, type: 4, name: 'Main', position: 0, parent_id: null },
                {
                  id: 3,
                  type: 0,
                  name: 'talk',
                  position: 0,
                  parent_id: 2,
                  permission_overwrites: [{ id: 1, type: 0, allow: String(1n << 11n), deny: '0' }],
                },
              ],
            },
          }),
        )) as typeof fetch,
      record: async (_guild: string, _by: unknown, _summary: string, result: ImportResult) => {
        recorded.push(result);
      },
      onError: () => {},
    };

    const id = await previewImport(deps, guild, 'https://discord.new/tmpl', { id: user });
    const row = await store.getImport(guild, id);
    expect(row?.status).toBe('previewed');

    const result = await applyImport(deps, guild, id, { id: user });
    expect(result?.roles.map((r) => r.name)).toEqual(['Crew']);
    const talk = created.channels.find((c) => c.name === 'talk');
    const main = created.channels.find((c) => c.name === 'Main');
    expect(talk?.parentId).toBe(main?.id);
    expect(talk?.overwrites).toEqual([
      { id: result?.roles[0]?.id, type: 'role', allow: ['SendMessages'], deny: [] },
    ]);
    expect(roleEdits).toEqual([{ id: guild, edit: { permissionBits: speak } }]);
    expect(result?.everyone).toEqual({ before: everyoneBefore, after: speak });
    expect(recorded).toHaveLength(1);
    expect((await store.getImport(guild, id))?.status).toBe('applied');
    expect(await applyImport(deps, guild, id, { id: user })).toBeNull();

    const bad = await previewImport(deps, guild, 'not a template link', { id: user });
    expect((await store.getImport(guild, bad))?.status).toBe('failed');
    expect((await store.listImports(guild)).length).toBe(2);
  });

  it('exports and forgets who took snapshots and imports', async () => {
    const other = '300000000000000002';
    await store.insert(guild, 'manual', data('a', 'b'), { label: 'mine', by: other });
    await store.createImport(guild, 'abc', other);
    const mine = await store.createdBy(guild, other);
    expect(mine.snapshots.map((row) => row.label)).toEqual(['mine']);
    expect(mine.snapshots[0]?.number).toBeGreaterThan(0);
    expect(mine.imports.map((row) => row.code)).toEqual(['abc']);
    expect(await store.forgetCreator(guild, other)).toBe(2);
    const after = await store.createdBy(guild, other);
    expect(after.snapshots).toEqual([]);
    expect(after.imports).toEqual([]);
    expect((await store.list(guild)).length).toBeGreaterThan(0);
  });
});
