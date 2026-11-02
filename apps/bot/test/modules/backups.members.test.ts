import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/backups';
import { BackupStore } from '@maxwell/core/stores/backups';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';
import { MemberRoleBackup, sameRoles } from '../../src/modules/backups/members.js';
import type { MemberRoles, MemberUpdate, RoleRef } from '../../src/platform/types.js';

const url = process.env.TEST_DATABASE_URL;

describe('sameRoles', () => {
  it('ignores order', () => {
    expect(sameRoles(['1', '2'], ['2', '1'])).toBe(true);
    expect(sameRoles(['1'], ['1', '2'])).toBe(false);
    expect(sameRoles(['1', '3'], ['1', '2'])).toBe(false);
  });
});

describe.skipIf(!url)('member role backup', () => {
  let sql: Sql;
  let store: BackupStore;
  let backup: MemberRoleBackup;
  const guild = String(917_000_000_000_000n + BigInt(Math.floor(Math.random() * 1_000_000_000)));
  const member = '430000000000000001';
  const other = '430000000000000002';
  const mods = '440000000000000001';
  const vip = '440000000000000002';

  let live: string[] = [];
  let enabled = true;
  let pages: MemberRoles[][] | null = [];
  let failing = new Set<string>();
  const added: { userId: string; roleId: string }[] = [];
  const asked: (string | null)[] = [];

  const role = (id: string): RoleRef => ({
    id,
    name: id,
    color: 0,
    position: 1,
    permissions: '0',
    managed: false,
    hoist: false,
    mentionable: false,
  });

  const update = (userId: string, roles: string[], before: string[] | null): MemberUpdate => ({
    guildId: guild,
    user: { id: userId, username: 'u', displayName: 'u', bot: false, avatarUrl: '' },
    nick: null,
    roles,
    timeoutUntil: null,
    before: before ? { nick: null, roles: before, timeoutUntil: null } : null,
  });

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'backups', migrations: definition.migrations },
    ]);
    store = new BackupStore(sql);
    const ctx = {
      config: async () => ({ memberRoles: enabled }),
      services: {
        log: createLogger('silent', false),
        platform: {
          roles: async () => [guild, ...live].map(role),
          memberRoles: async (_guild: string, after: string | null) => {
            asked.push(after);
            return pages ? (pages.shift() ?? []) : null;
          },
          addRole: async (_guild: string, userId: string, roleId: string) => {
            if (failing.has(userId)) throw new Error('missing access');
            added.push({ userId, roleId });
          },
        },
      },
    };
    backup = new MemberRoleBackup(ctx as never, store);
  });

  beforeEach(async () => {
    await store.clearMemberRoles(guild);
    live = [mods, vip];
    enabled = true;
    pages = [];
    failing = new Set();
    added.length = 0;
    asked.length = 0;
  });

  afterAll(async () => {
    await store.clearMemberRoles(guild);
    await sql.end();
  });

  it('follows role changes of members', async () => {
    await backup.onUpdate(update(member, [mods, vip], null));
    expect(await store.memberRolesOf(guild, member)).toEqual([mods, vip]);
    await backup.onUpdate(update(member, [vip], [mods, vip]));
    expect(await store.memberRolesOf(guild, member)).toEqual([vip]);
    await backup.onUpdate(update(member, [guild, vip], null));
    expect(await store.memberRolesOf(guild, member)).toEqual([vip]);
  });

  it('keeps the members of a deleted role', async () => {
    await backup.onUpdate(update(member, [mods], null));
    await backup.onUpdate(update(other, [mods, vip], null));
    await backup.onRoleDelete({ guildId: guild, roleId: mods, role: null, before: null });
    live = [vip];
    await backup.onUpdate(update(other, [vip], [mods, vip]));
    expect(await store.roleMembers(guild, mods)).toEqual([member, other]);
  });

  it('gives a recreated role back to its members', async () => {
    const recreated = '440000000000000009';
    await backup.onUpdate(update(member, [mods], null));
    await backup.onUpdate(update(other, [mods], null));
    await backup.onRoleDelete({ guildId: guild, roleId: mods, role: null, before: null });
    expect(await backup.giveBack(guild, mods, recreated, 'Undo')).toBe(2);
    expect(added).toEqual([
      { userId: member, roleId: recreated },
      { userId: other, roleId: recreated },
    ]);
    expect(await store.roleMembers(guild, mods)).toEqual([]);
    expect(await store.roleMembers(guild, recreated)).toEqual([member, other]);
  });

  it('stops after repeated failures', async () => {
    const users = Array.from({ length: 15 }, (_, i) =>
      String(450_000_000_000_000_000n + BigInt(i)),
    );
    await store.setMemberRoles(
      guild,
      users.map((userId) => ({ userId, roleIds: [mods] })),
      live,
    );
    failing = new Set(users);
    expect(await backup.giveBack(guild, mods, mods, 'Undo')).toBe(0);
    expect(added).toHaveLength(0);
  });

  it('syncs every member page by page', async () => {
    const first = Array.from({ length: 1000 }, (_, i) => ({
      userId: String(460_000_000_000_000_000n + BigInt(i)),
      roles: i % 2 === 0 ? [mods] : [],
    }));
    await backup.onUpdate(update(other, [vip], null));
    pages = [first, [{ userId: member, roles: [vip, guild] }]];
    expect(await backup.sync(guild, 14)).toBe(true);
    expect(asked).toEqual([null, first.at(-1)?.userId]);
    expect(await store.roleMembers(guild, mods)).toHaveLength(500);
    expect(await store.memberRolesOf(guild, member)).toEqual([vip]);
    expect(await store.memberRolesOf(guild, other)).toEqual([]);
  });

  it('marks roles that vanished while offline as deleted', async () => {
    await backup.onUpdate(update(member, [mods, vip], null));
    live = [vip];
    pages = [[{ userId: member, roles: [vip] }]];
    expect(await backup.sync(guild, 14)).toBe(true);
    expect(await store.roleMembers(guild, mods)).toEqual([member]);
  });

  it('keeps what it has when the member list is not readable', async () => {
    await backup.onUpdate(update(member, [mods], null));
    pages = null;
    expect(await backup.sync(guild, 14)).toBe(false);
    expect(await store.memberRolesOf(guild, member)).toEqual([mods]);
  });

  it('forgets members who leave and clears everything when turned off', async () => {
    await backup.onUpdate(update(member, [mods], null));
    await backup.onUpdate(update(other, [mods], null));
    await backup.onLeave({ guildId: guild, userId: member, user: null });
    expect(await store.roleMembers(guild, mods)).toEqual([other]);
    enabled = false;
    await backup.onUpdate(update(member, [mods], null));
    expect(await backup.sync(guild, 14)).toBe(false);
    expect(await store.roleMembers(guild, mods)).toEqual([]);
  });
});
