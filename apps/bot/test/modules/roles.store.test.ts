import { connect, enqueue, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/roles';
import { RolesStore } from '@maxwell/core/stores/roles';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('RolesStore', () => {
  let sql: Sql;
  let store: RolesStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const role = '100000000000000001';
  const day = 24 * 60 * 60_000;

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'roles', migrations: definition.migrations },
    ]);
    store = new RolesStore(sql);
  });

  afterAll(async () => {
    await sql`delete from roles_menu_messages where guild_id = ${guild}`;
    await sql`delete from roles_temporary where guild_id = ${guild}`;
    await sql`delete from roles_members where guild_id = ${guild}`;
    await sql`delete from roles_time_granted where guild_id = ${guild}`;
    await sql`delete from guild_modules where guild_id = ${guild}`;
    await sql`delete from guilds where id = ${guild}`;
    await sql.end();
  });

  it('links menus to their messages', async () => {
    const messageId = `${guild.slice(0, 12)}000001`;
    await store.saveMenuMessage(guild, 'colors', '200000000000000001', messageId, [
      '⭐',
      'blue:300000000000000001',
    ]);
    const link = await store.menuByMessage(messageId);
    expect(link).toMatchObject({ guildId: guild, menuId: 'colors' });
    expect(link?.emojis).toEqual(['⭐', 'blue:300000000000000001']);
    expect((await store.menuMessages(guild)).length).toBe(1);
    expect(await store.removeMenuByMessage(messageId)).not.toBeNull();
    expect(await store.menuMessage(guild, 'colors')).toBeNull();
  });

  it('keeps one expiry per temporary role', async () => {
    const user = '300000000000000001';
    await store.setTemporary(guild, user, role, new Date(Date.now() + 1_000));
    const later = new Date(Date.now() + day);
    await store.setTemporary(guild, user, role, later);
    const row = await store.temporary(guild, user, role);
    expect(row?.expiresAt.getTime()).toBe(later.getTime());
    expect(await store.temporaryRoles(guild)).toHaveLength(1);
    expect(await store.removeTemporary(guild, user, role)).toBe(true);
    expect(await store.temporary(guild, user, role)).toBeNull();
  });

  it('remembers sticky roles across a leave', async () => {
    const user = '300000000000000002';
    await store.recordJoin(guild, user, new Date(Date.now() - day));
    await store.setSticky(guild, user, [role, '100000000000000002']);
    await store.recordLeave(guild, user);
    const before = await store.recordJoin(guild, user, new Date());
    expect(before?.leftAt).not.toBeNull();
    expect(before?.stickyRoleIds.sort()).toEqual([role, '100000000000000002']);
    expect((await store.member(guild, user))?.leftAt).toBeNull();
  });

  it('finds members due for a time role once', async () => {
    const old = '300000000000000003';
    const fresh = '300000000000000004';
    await store.recordJoin(guild, old, new Date(Date.now() - 10 * day));
    await store.recordSeen(guild, fresh, new Date(Date.now() - day));
    const due = await store.dueForTimeRole(guild, role, new Date(Date.now() - 7 * day));
    expect(due).toContain(old);
    expect(due).not.toContain(fresh);
    await store.markTimeGranted(guild, old, role);
    expect(await store.dueForTimeRole(guild, role, new Date(Date.now() - 7 * day))).not.toContain(
      old,
    );
    expect(await store.timeGrantedCount(guild, role)).toBe(1);
  });

  it('forgets a time grant when the member rejoins', async () => {
    const user = '300000000000000003';
    await store.recordLeave(guild, user);
    await store.recordJoin(guild, user, new Date(Date.now() - 8 * day));
    expect(await store.dueForTimeRole(guild, role, new Date(Date.now() - 7 * day))).toContain(user);
  });

  it('prunes members who left long ago', async () => {
    const user = '300000000000000005';
    await store.recordJoin(guild, user, new Date(Date.now() - day));
    await sql`
      update roles_members set left_at = now() - interval '400 days'
      where guild_id = ${guild} and user_id = ${user}
    `;
    expect(await store.pruneLeft(guild, new Date(Date.now() - 180 * day))).toBe(1);
    expect(await store.member(guild, user)).toBeNull();
  });

  it('exports and forgets a member but keeps running temporary roles', async () => {
    const user = '300000000000000006';
    await store.recordJoin(guild, user, new Date(Date.now() - 10 * day));
    await store.markTimeGranted(guild, user, role);
    await store.setTemporary(guild, user, role, new Date(Date.now() + day));
    expect((await store.timeGranted(guild, user)).map((grant) => grant.roleId)).toEqual([role]);
    expect(await store.temporaryFor(guild, user)).toHaveLength(1);
    await store.forgetMember(guild, user);
    expect(await store.member(guild, user)).toBeNull();
    expect(await store.timeGranted(guild, user)).toEqual([]);
    expect(await store.temporaryFor(guild, user)).toHaveLength(1);
  });

  it('pulls waiting jobs forward', async () => {
    const prefix = `roles.wait:${guild}:300000000000000007`;
    const later = new Date(Date.now() + day);
    await enqueue(sql, { kind: 'roles.auto.grant', runAt: later, dedupeKey: `${prefix}:auto` });
    await enqueue(sql, { kind: 'roles.auto.grant', runAt: later, dedupeKey: `${prefix}7:auto` });
    const soon = new Date(Date.now() + 5_000);
    expect(await store.wakeJobs(prefix, soon)).toBe(1);
    expect(await store.wakeJobs(prefix, soon)).toBe(0);
    await sql`delete from jobs where dedupe_key like ${`roles.wait:${guild}:%`}`;
  });

  it('lists guilds that use the module', async () => {
    await sql`insert into guilds (id) values (${guild}) on conflict do nothing`;
    await sql`insert into guild_modules (guild_id, module, enabled) values (${guild}, 'roles', true)`;
    expect(await store.configuredGuilds()).toContain(guild);
  });
});
