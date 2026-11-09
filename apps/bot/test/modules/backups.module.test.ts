import { type AuditInput, connect, type Job, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/backups';
import { BackupStore } from '@maxwell/core/stores/backups';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { createLogger } from '../../src/log.js';
import backups from '../../src/modules/backups/index.js';
import type { ChannelRef, RoleInput, RoleRef } from '../../src/platform/types.js';
import { createContext } from '../../src/runtime/module.js';
import { PrivacyRegistry } from '../../src/runtime/privacy.js';
import type { JobHandler } from '../../src/runtime/scheduler.js';
import type { Services } from '../../src/services.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('backups module', () => {
  let sql: Sql;
  let store: BackupStore;
  const guild = String(916_000_000_000_000n + BigInt(Math.floor(Math.random() * 1_000_000_000)));
  const user = '420000000000000001';
  const operator = '420000000000000002';
  const created: RoleInput[] = [];
  const jobs = new Map<string, JobHandler>();
  const records: AuditInput[] = [];
  const given: { userId: string; roleId: string }[] = [];
  let overrides: Record<string, unknown> = {};

  const roles: RoleRef[] = [
    {
      id: guild,
      name: '@everyone',
      color: 0,
      position: 0,
      permissions: '0',
      managed: false,
      hoist: false,
      mentionable: false,
    },
  ];
  const channels: ChannelRef[] = [
    {
      id: '510000000000000001',
      guildId: guild,
      name: 'general',
      type: 0,
      parentId: null,
      position: 0,
      topic: null,
      nsfw: false,
      userLimit: null,
      rateLimitPerUser: 0,
      overwrites: [],
    },
  ];

  const job = (payload: Record<string, unknown>): Job => ({
    id: String(Math.random()),
    kind: 'backups.restore',
    guildId: guild,
    payload,
    runAt: new Date(),
    attempts: 1,
  });

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'backups', migrations: definition.migrations },
    ]);
    store = new BackupStore(sql);
    const services = {
      sql,
      privacy: new PrivacyRegistry(),
      log: createLogger('silent', false),
      platform: {
        on: () => {},
        roles: async () => roles,
        channels: async () => channels,
        hasPermissions: async () => false,
        memberRoles: async () => null,
        addRole: async (_guild: string, userId: string, roleId: string) => {
          given.push({ userId, roleId });
        },
        createRole: async (_guild: string, input: RoleInput) => {
          created.push(input);
          return String(610_000_000_000_000_000n + BigInt(created.length));
        },
      },
      config: { OWNER_IDS: [operator] },
      jobs: {
        handle: (kind: string, handler: JobHandler) => jobs.set(kind, handler),
        enqueue: async () => null,
      },
      undo: { handle: () => {} },
      settings: {
        config: async (_g: string, _k: string, schema: z.ZodType) =>
          schema.parse({ includeModules: false, ...overrides }),
        enabled: async () => true,
      },
      audit: {
        record: async (input: AuditInput) => {
          records.push(input);
          return String(records.length);
        },
      },
    } as unknown as Services;
    await backups.setup?.(createContext(backups.definition, services));
  });

  afterAll(async () => {
    await sql`delete from backups_snapshots where guild_id = ${guild}`;
    await sql`delete from backups_imports where guild_id = ${guild}`;
    await store.clearMemberRoles(guild);
    await sql.end();
  });

  it('takes a snapshot before it restores', async () => {
    const source = await store.insert(guild, 'daily', {
      version: 2,
      roles: [],
      channels: [],
      modules: {},
    });
    await jobs.get('backups.restore')?.(job({ snapshotId: source.id, scope: 'full', by: user }));
    const list = await store.list(guild);
    expect(list).toHaveLength(2);
    expect(list[0]?.kind).toBe('manual');
    expect(list[0]?.label).toBe('Before restore');
    expect(list[0]?.createdBy).toBe(user);
    expect(list[0]?.channelCount).toBe(1);
  });

  it('skips that snapshot when it is turned off', async () => {
    overrides = { snapshotBeforeRestore: false };
    const before = (await store.list(guild)).length;
    const [latest] = await store.list(guild);
    await jobs.get('backups.restore')?.(
      job({ snapshotId: latest?.id, scope: 'pick', roles: [], channels: ['510000000000000001'] }),
    );
    expect(await store.list(guild)).toHaveLength(before);
  });

  it('saves a snapshot after an automatic restore only', async () => {
    overrides = { snapshotBeforeRestore: false };
    const [latest] = await store.list(guild);
    const before = (await store.list(guild)).length;
    await jobs.get('backups.restore')?.(
      job({ snapshotId: latest?.id, scope: 'pick', channels: ['510000000000000001'] }),
    );
    expect(await store.list(guild)).toHaveLength(before);
    await jobs.get('backups.restore')?.(
      job({
        snapshotId: latest?.id,
        scope: 'pick',
        channels: ['510000000000000001'],
        automatic: true,
      }),
    );
    const after = await store.list(guild);
    expect(after).toHaveLength(before + 1);
    expect(after[0]?.label).toBe('After an automatic restore');
  });

  it('ignores a pick with nothing in it', async () => {
    overrides = {};
    const before = (await store.list(guild)).length;
    const [latest] = await store.list(guild);
    await jobs.get('backups.restore')?.(job({ snapshotId: latest?.id, scope: 'pick' }));
    expect(await store.list(guild)).toHaveLength(before);
  });

  it('gives a restored role back to the members who had it', async () => {
    const deleted = '440000000000000077';
    await store.setMemberRoles(guild, [{ userId: user, roleIds: [deleted] }], [deleted]);
    await store.markRolesDeleted(guild, [deleted]);
    const source = await store.insert(guild, 'daily', {
      version: 2,
      roles: [
        {
          id: deleted,
          name: 'Regulars',
          color: 0,
          position: 0,
          permissions: '0',
          hoist: false,
          mentionable: false,
        },
      ],
      channels: [],
      modules: {},
    });
    await jobs.get('backups.restore')?.(
      job({ snapshotId: source.id, scope: 'role', id: deleted, by: user }),
    );
    const id = String(610_000_000_000_000_000n + BigInt(created.length));
    expect(created.at(-1)?.name).toBe('Regulars');
    expect(given).toEqual([{ userId: user, roleId: id }]);
    expect(await store.roleMembers(guild, id)).toEqual([user]);
    expect(records.at(-1)?.after).toMatchObject({ members: 1 });
  });

  it('withholds dangerous permissions from bot operators like from anyone else', async () => {
    const apply = async (by: string) => {
      const importId = await store.createImport(guild, 'template:1', by);
      await store.setImportPlan(guild, importId, {
        source: { code: 'template:1', name: 'Takeover', description: null },
        everyone: null,
        roles: [
          {
            key: 'r1',
            name: 'Boss',
            color: 0,
            hoist: false,
            mentionable: false,
            permissions: ['Administrator', 'ManageMessages'],
          },
        ],
        channels: [],
        droppedPermissions: [],
        skipped: [],
      });
      await jobs.get('backups.import.apply')?.(job({ importId, by }));
      return store.getImport(guild, importId);
    };
    const denied = await apply(user);
    expect(denied?.status).toBe('applied');
    expect(denied?.result).toMatchObject({ withheld: ['Administrator'] });
    expect(created.at(-1)?.permissions).toEqual(['ManageMessages']);
    const operatorRun = await apply(operator);
    expect(operatorRun?.result).toMatchObject({ withheld: ['Administrator'] });
    expect(created.at(-1)?.permissions).toEqual(['ManageMessages']);
  });
});
