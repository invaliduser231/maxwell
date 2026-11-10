import type { Job } from '@maxwell/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuildContext } from '../../src/commands/types.js';
import { Confirmations } from '../../src/modules/moderation/confirm.js';
import { BULK_PAGE, BulkRoles, findRole } from '../../src/modules/roles/bulk.js';
import { permissionBits } from '../../src/platform/permissions.js';
import type { RoleRef } from '../../src/platform/types.js';

const guild = '100000000000000001';
const bot = '200000000000000001';
const owner = '300000000000000001';
const mod = '300000000000000002';
const target = '500000000000000010';

const role = (id: string, name: string, position: number, perms: string[] = []): RoleRef => ({
  id,
  name,
  color: 0,
  position,
  permissions: permissionBits(perms as never),
  managed: false,
  hoist: false,
  mentionable: false,
});

const roles = [
  role(guild, '@everyone', 0),
  role(target, 'Verificado', 2),
  role('500000000000000011', 'Admin', 5, ['Administrator']),
  role('500000000000000012', 'Bot', 4),
  role('500000000000000013', 'Mod', 3),
];

function setup(memberCount: number, withRole: string[] = []) {
  const members = Array.from({ length: memberCount }, (_, i) => ({
    userId: String(400000000000000000n + BigInt(i)),
    roles: withRole.includes(String(400000000000000000n + BigInt(i))) ? [target] : [],
  }));
  const added: string[] = [];
  const removed: string[] = [];
  const edits: string[] = [];
  const scheduled: Record<string, unknown>[] = [];
  const records: string[] = [];
  const platform = {
    selfId: bot,
    roles: async () => roles,
    guildOwner: async () => owner,
    guild: async () => ({ id: guild, name: 'Test', memberCount, iconUrl: null }),
    member: async (_g: string, userId: string) => ({
      roles: userId === bot ? ['500000000000000012'] : ['500000000000000013'],
    }),
    memberRoles: async (_g: string, after: string | null, limit: number) => {
      const start = after ? members.findIndex((m) => m.userId === after) + 1 : 0;
      return members.slice(start, start + limit);
    },
    addRole: async (_g: string, userId: string) => {
      added.push(userId);
    },
    removeRole: async (_g: string, userId: string) => {
      removed.push(userId);
    },
    edit: async (_c: string, _m: string, content: string) => {
      edits.push(content);
    },
    react: async () => {},
    unreact: async () => {},
  };
  const ctx = {
    services: { platform, log: { debug: () => {} } },
    schedule: async (_kind: string, input: { payload: Record<string, unknown> }) => {
      scheduled.push(input.payload);
      return 'job';
    },
    record: async (_g: string, _by: unknown, _a: string, summary: string) => {
      records.push(summary);
      return 'audit';
    },
  };
  const confirmations = new Confirmations();
  const bulk = new BulkRoles(ctx as never, confirmations);
  const replies: string[] = [];
  const cmd = (author: string) =>
    ({
      guildId: guild,
      prefix: '!',
      message: { author: { id: author }, channelId: '700000000000000001', id: '1' },
      platform,
      services: { voice: { icons: { reaction: () => null }, icon: () => '' } },
      reply: async (out: string | { content: string }) => {
        replies.push(typeof out === 'string' ? out : out.content);
        return '800000000000000001';
      },
    }) as unknown as GuildContext;
  const job = (payload: Record<string, unknown>): Job =>
    ({ id: 'j', kind: 'roles.bulk.run', guildId: guild, payload }) as Job;
  return { bulk, cmd, job, added, removed, edits, scheduled, records, replies, confirmations };
}

const start = {
  roleId: target,
  mode: 'add',
  by: mod,
  channelId: '700000000000000001',
  messageId: '800000000000000001',
  after: null,
  done: 0,
  changed: 0,
  failed: 0,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function drain<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const result = promise.finally(() => {
    done = true;
  });
  while (!done) await vi.advanceTimersByTimeAsync(1_000);
  return result;
}

describe('bulk roles', () => {
  it('finds roles by mention, id and name', () => {
    expect(findRole(roles, `<@&${target}>`)?.name).toBe('Verificado');
    expect(findRole(roles, '@verificado')?.id).toBe(target);
    expect(findRole(roles, 'nope')).toBeNull();
  });

  it('gives the role page by page and skips members who have it', async () => {
    const h = setup(BULK_PAGE + 3, ['400000000000000001']);
    await drain(h.bulk.run(h.job(start)));
    expect(h.added).toHaveLength(BULK_PAGE - 1);
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0]).toMatchObject({ done: BULK_PAGE, changed: BULK_PAGE - 1 });
    await drain(h.bulk.run(h.job(h.scheduled[0] as Record<string, unknown>)));
    expect(h.added).toHaveLength(BULK_PAGE + 2);
    expect(h.records).toEqual([`Gave Verificado to ${BULK_PAGE + 2} members`]);
    expect(h.edits.at(-1)).toContain(`${BULK_PAGE + 2} members got`);
    expect(h.bulk.running(guild)).toBeNull();
  });

  it('takes the role away in clear mode', async () => {
    const h = setup(3, ['400000000000000000', '400000000000000002']);
    await drain(h.bulk.run(h.job({ ...start, mode: 'remove' })));
    expect(h.removed).toEqual(['400000000000000000', '400000000000000002']);
    expect(h.added).toEqual([]);
  });

  it('stops when asked', async () => {
    const h = setup(10);
    const running = h.bulk.run(h.job(start));
    await vi.advanceTimersByTimeAsync(600);
    await h.bulk.stop(h.cmd(mod));
    await drain(running);
    expect(h.added.length).toBeLessThan(10);
    expect(h.edits.at(-1)).toContain('Stopped after');
    expect(h.scheduled).toEqual([]);
  });

  it('refuses dangerous roles and roles above the author', async () => {
    const h = setup(1);
    expect(await h.bulk.check(h.cmd(mod), 'Admin')).toContain('Administrator');
    expect(await h.bulk.check(h.cmd(mod), '@everyone')).toContain('Everyone already has');
    expect(await h.bulk.check(h.cmd(mod), 'Mod')).toContain('above your highest role');
    expect(await h.bulk.check(h.cmd(owner), 'Mod')).toMatchObject({ id: '500000000000000013' });
    expect(await h.bulk.check(h.cmd(owner), 'Bot')).toContain('above my highest role');
  });
});
