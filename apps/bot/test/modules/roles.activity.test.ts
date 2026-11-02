import { connect, migrate, type Sql } from '@maxwell/core';
import definition, { type RolesConfig, rolesConfig } from '@maxwell/core/modules/roles';
import { RolesStore } from '@maxwell/core/stores/roles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';
import { ActivityRoles, dayOf, sinceDay } from '../../src/modules/roles/activity.js';
import type { Holds } from '../../src/modules/roles/held.js';
import type { IncomingMessage } from '../../src/platform/types.js';

const url = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;

describe('activity days', () => {
  it('counts the window including today', () => {
    const now = Date.parse('2026-11-02T20:00:00Z');
    expect(dayOf(now)).toBe('2026-11-02');
    expect(sinceDay(1, now)).toBe('2026-11-02');
    expect(sinceDay(7, now)).toBe('2026-10-27');
  });
});

describe.skipIf(!url)('activity roles', () => {
  let sql: Sql;
  let store: RolesStore;
  let activity: ActivityRoles;
  let config: RolesConfig;
  const guild = String(918_000_000_000_000n + BigInt(Math.floor(Math.random() * 1_000_000_000)));
  const role = '440000000000000101';
  const chatty = '430000000000000101';
  const quiet = '430000000000000102';
  const manual = '430000000000000103';
  const roles = new Map<string, string[]>();
  const calls: string[] = [];
  const now = Date.parse('2026-11-02T20:00:00Z');

  const message = (userId: string, bot = false): IncomingMessage =>
    ({
      id: '1',
      channelId: '2',
      guildId: guild,
      content: 'hi',
      author: { id: userId, bot },
      fromWebhook: false,
      memberRoles: [],
    }) as unknown as IncomingMessage;

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'roles', migrations: definition.migrations },
    ]);
    store = new RolesStore(sql);
    const ctx = {
      services: {
        log: createLogger('silent', false),
        platform: {
          member: async (_guild: string, userId: string) => ({
            user: { id: userId, bot: false },
            roles: roles.get(userId) ?? [],
          }),
          addRole: async (_guild: string, userId: string, roleId: string) => {
            calls.push(`add ${userId}`);
            roles.set(userId, [...(roles.get(userId) ?? []), roleId]);
          },
          removeRole: async (_guild: string, userId: string, roleId: string) => {
            calls.push(`remove ${userId}`);
            roles.set(
              userId,
              (roles.get(userId) ?? []).filter((id) => id !== roleId),
            );
          },
        },
      },
    };
    const holds = { held: async () => false } as unknown as Holds;
    activity = new ActivityRoles(ctx as never, store, holds);
  });

  beforeEach(async () => {
    await sql`delete from roles_activity where guild_id = ${guild}`;
    await sql`delete from roles_activity_granted where guild_id = ${guild}`;
    roles.clear();
    roles.set(manual, [role]);
    calls.length = 0;
    config = rolesConfig.parse({ activityRoles: [{ roleId: role, messages: 3, days: 7 }] });
  });

  afterAll(async () => {
    await sql`delete from roles_activity where guild_id = ${guild}`;
    await sql`delete from roles_activity_granted where guild_id = ${guild}`;
    await sql.end();
  });

  it('counts messages of people, not bots', async () => {
    for (let i = 0; i < 3; i++) activity.count(message(chatty), now);
    activity.count(message(quiet), now);
    activity.count(message('430000000000000199', true), now);
    expect(await activity.flush()).toBe(2);
    expect(await store.activeMembers(guild, dayOf(now), 1)).toEqual([chatty, quiet]);
  });

  it('gives the role to active members and takes it back later', async () => {
    for (let i = 0; i < 3; i++) activity.count(message(chatty), now);
    activity.count(message(quiet), now);
    await activity.sweep(guild, config, now);
    expect(calls).toEqual([`add ${chatty}`]);
    expect(await store.activityGranted(guild, role)).toEqual([chatty]);

    calls.length = 0;
    await activity.sweep(guild, config, now + 8 * DAY);
    expect(calls).toEqual([`remove ${chatty}`]);
    expect(await store.activityGranted(guild, role)).toEqual([]);
    expect(roles.get(manual)).toEqual([role]);
  });

  it('forgets grants of rules that were removed', async () => {
    for (let i = 0; i < 3; i++) activity.count(message(chatty), now);
    await activity.sweep(guild, config, now);
    calls.length = 0;
    await activity.sweep(guild, rolesConfig.parse({}), now);
    expect(calls).toEqual([]);
    expect(await store.activityGranted(guild, role)).toEqual([]);
  });

  it('drops counts older than the longest window', async () => {
    activity.count(message(chatty), now - 100 * DAY);
    await activity.sweep(guild, config, now);
    const [row] = await sql<{ count: number }[]>`
      select count(*)::int as count from roles_activity where guild_id = ${guild}
    `;
    expect(row?.count).toBe(0);
  });
});
