import type { Job } from '@maxwell/core';
import { rolesConfig } from '@maxwell/core/modules/roles';
import type { MemberRecord, RolesStore } from '@maxwell/core/stores/roles';
import { describe, expect, it, vi } from 'vitest';
import {
  HOLD_LIMIT,
  HOLD_RECHECK,
  HOLD_SETTLE,
  type Holds,
  releasedFromGate,
  removedRoles,
  waitKey,
  waitPrefix,
  waitUntil,
} from '../../src/modules/roles/held.js';
import { Members } from '../../src/modules/roles/members.js';
import { Menus } from '../../src/modules/roles/menus.js';
import { rolesPrivacy } from '../../src/modules/roles/privacy.js';
import type { MemberUpdate, RoleRef } from '../../src/platform/types.js';
import type { ModuleContext } from '../../src/runtime/module.js';

const guildId = '900000000000000001';
const userId = '300000000000000001';
const auto = '100000000000000001';
const kept = '100000000000000002';
const gate = '100000000000000009';
const timeRole = '100000000000000003';

function role(id: string, position: number): RoleRef {
  return {
    id,
    name: id,
    color: 0,
    position,
    permissions: '0',
    managed: false,
    hoist: false,
    mentionable: false,
  };
}

function setup(
  options: {
    held?: boolean;
    watching?: boolean;
    config?: object;
    before?: Partial<MemberRecord> | null;
    roles?: string[];
  } = {},
) {
  const config = rolesConfig.parse(
    options.config ?? {
      autoroles: { roleIds: [auto] },
      sticky: { enabled: true, mode: 'all' },
    },
  );
  const memberRoles = options.roles ?? [];
  const calls: string[] = [];
  const platform = {
    selfId: null,
    member: vi.fn(async (_g: string, id: string) => ({
      guildId,
      user: { id, username: 'lena', displayName: 'Lena', bot: false, avatarUrl: '' },
      nick: null,
      roles: memberRoles,
      joinedAt: new Date(),
      timeoutUntil: null,
    })),
    roles: async () => [role(auto, 1), role(kept, 2), role(gate, 3), role(timeRole, 4)],
    addRole: vi.fn(async (_g: string, _u: string, roleId: string) => {
      calls.push(`add ${roleId}`);
    }),
    guildIds: () => [guildId],
  };
  const before =
    options.before === undefined
      ? null
      : options.before && {
          guildId,
          userId,
          joinedAt: new Date(0),
          leftAt: new Date(1),
          stickyRoleIds: [],
          ...options.before,
        };
  const store = {
    recordJoin: vi.fn(async () => before),
    recordLeave: vi.fn(async () => {}),
    setSticky: vi.fn(async () => {}),
    dueForTimeRole: vi.fn(async () => [userId]),
    markTimeGranted: vi.fn(async () => {}),
    pruneLeft: vi.fn(async () => 0),
  };
  const holds = {
    watching: vi.fn(async () => options.watching ?? false),
    gateRole: vi.fn(async () => gate),
    held: vi.fn(async () => options.held ?? false),
    wake: vi.fn(async () => {}),
  } satisfies Holds;
  const schedule = vi.fn(async () => '1');
  const record = vi.fn(async () => '1');
  const ctx = {
    config: async () => config,
    enabled: async () => true,
    schedule,
    record,
    services: { platform, log: { warn() {}, info() {}, debug() {}, error() {} } },
  } as unknown as ModuleContext<typeof rolesConfig>;
  const members = new Members(ctx, store as unknown as RolesStore, holds);
  return { members, platform, store, holds, schedule, record, calls };
}

function job(kind: string, payload: Record<string, unknown>): Job {
  return { id: '1', kind, guildId, payload, runAt: new Date(), attempts: 1 };
}

const user = { id: userId, username: 'lena', displayName: 'Lena', bot: false, avatarUrl: '' };

describe('hold helpers', () => {
  it('builds wait keys under one prefix per member', () => {
    expect(waitKey('roles', guildId, userId, 'auto')).toBe(
      `${waitPrefix('roles', guildId, userId)}:auto`,
    );
  });

  it('stops waiting after the limit', () => {
    const now = 10 * HOLD_LIMIT;
    expect(waitUntil(now - 1_000, now)?.getTime()).toBe(now + HOLD_RECHECK);
    expect(waitUntil(now - HOLD_LIMIT - 1, now)).toBeNull();
  });

  it('notices when the gate role is taken away', async () => {
    const update: MemberUpdate = {
      guildId,
      user,
      nick: null,
      roles: [kept],
      timeoutUntil: null,
      before: { nick: null, roles: [kept, gate], timeoutUntil: null },
    };
    expect(removedRoles(update)).toEqual([gate]);
    const holds = { gateRole: async () => gate } as unknown as Holds;
    expect(await releasedFromGate(holds, update)).toBe(true);
    expect(await releasedFromGate(holds, { ...update, before: null })).toBe(false);
    expect(
      await releasedFromGate(holds, {
        ...update,
        before: { nick: null, roles: [kept, auto], timeoutUntil: null },
      }),
    ).toBe(false);
  });
});

describe('Members and the automod gate', () => {
  it('gives autoroles right away when nobody is held', async () => {
    const { members, calls, schedule } = setup();
    await members.onJoin({ guildId, user, joinedAt: new Date() });
    expect(calls).toEqual([`add ${auto}`]);
    expect(schedule).not.toHaveBeenCalledWith('auto.grant', expect.anything());
  });

  it('waits with autoroles while the member is held', async () => {
    const { members, calls, schedule } = setup({ held: true });
    await members.onJoin({ guildId, user, joinedAt: new Date() });
    expect(calls).toEqual([]);
    expect(schedule).toHaveBeenCalledWith(
      'auto.grant',
      expect.objectContaining({
        dedupeKey: waitKey('roles', guildId, userId, 'auto'),
        payload: expect.objectContaining({ userId, roleIds: [auto] }),
      }),
    );
  });

  it('lets the raid shield look first when it is watching joins', async () => {
    const { members, calls, schedule } = setup({ watching: true });
    const joinedAt = new Date();
    await members.onJoin({ guildId, user, joinedAt });
    expect(calls).toEqual([]);
    expect(schedule).toHaveBeenCalledWith(
      'auto.grant',
      expect.objectContaining({ runAt: new Date(joinedAt.getTime() + HOLD_SETTLE) }),
    );
  });

  it('gives up on a hold that never ends', async () => {
    const { members, schedule } = setup({ held: true });
    await members.grantDelayed(
      job('roles.auto.grant', { userId, roleIds: [auto], since: Date.now() - HOLD_LIMIT - 1 }),
    );
    expect(schedule).not.toHaveBeenCalled();
  });

  it('restores sticky roles after the settle delay, without the gate role', async () => {
    const watching = setup({
      watching: true,
      config: { sticky: { enabled: true, mode: 'all' } },
      before: { stickyRoleIds: [kept, gate] },
    });
    await watching.members.onJoin({ guildId, user, joinedAt: new Date() });
    expect(watching.calls).toEqual([]);
    expect(watching.schedule).toHaveBeenCalledWith(
      'sticky.restore',
      expect.objectContaining({
        payload: expect.objectContaining({ roleIds: [kept, gate], name: 'Lena' }),
      }),
    );

    const free = setup({ config: { sticky: { enabled: true, mode: 'all' } } });
    await free.members.restoreDelayed(
      job('roles.sticky.restore', {
        userId,
        roleIds: [kept, gate],
        name: 'Lena',
        since: Date.now(),
      }),
    );
    expect(free.calls).toEqual([`add ${kept}`]);
    expect(free.record).toHaveBeenCalledOnce();
  });

  it('keeps sticky roles waiting while held', async () => {
    const { members, calls, schedule } = setup({
      held: true,
      config: { sticky: { enabled: true, mode: 'all' } },
    });
    await members.restoreDelayed(
      job('roles.sticky.restore', { userId, roleIds: [kept], name: 'Lena', since: Date.now() }),
    );
    expect(calls).toEqual([]);
    expect(schedule).toHaveBeenCalledWith(
      'sticky.restore',
      expect.objectContaining({ dedupeKey: waitKey('roles', guildId, userId, 'sticky') }),
    );
  });

  it('wakes waiting jobs on release and skips snapshots at the gate', async () => {
    const { members, holds, store } = setup();
    await members.onUpdate({
      guildId,
      user,
      nick: null,
      roles: [kept, gate],
      timeoutUntil: null,
      before: { nick: null, roles: [kept], timeoutUntil: null },
    });
    expect(holds.wake).not.toHaveBeenCalled();
    expect(store.setSticky).not.toHaveBeenCalled();

    await members.onUpdate({
      guildId,
      user,
      nick: null,
      roles: [kept],
      timeoutUntil: null,
      before: { nick: null, roles: [kept, gate], timeoutUntil: null },
    });
    expect(holds.wake).toHaveBeenCalledWith(waitPrefix('roles', guildId, userId));
    expect(store.setSticky).toHaveBeenCalledWith(guildId, userId, [kept]);
  });

  it('holds back time roles from held members', async () => {
    const config = { timeRoles: [{ roleId: timeRole, days: 7 }] };
    const held = setup({ held: true, config });
    await held.members.sweep(job('roles.time.sweep', {}));
    expect(held.calls).toEqual([]);
    expect(held.store.markTimeGranted).not.toHaveBeenCalled();

    const free = setup({ config });
    await free.members.sweep(job('roles.time.sweep', {}));
    expect(free.calls).toEqual([`add ${timeRole}`]);
    expect(free.store.markTimeGranted).toHaveBeenCalledWith(guildId, userId, timeRole);
  });
});

describe('roles privacy', () => {
  it('exports tracking data and forgets it', async () => {
    const store = {
      member: vi.fn(async () => ({
        guildId,
        userId,
        joinedAt: new Date(0),
        leftAt: null,
        stickyRoleIds: [kept],
      })),
      timeGranted: vi.fn(async () => [{ roleId: timeRole, grantedAt: new Date(0) }]),
      temporaryFor: vi.fn(async () => []),
      activityFor: vi.fn(async () => ({
        days: [{ day: '2026-11-01', messages: 4 }],
        roleIds: [timeRole],
      })),
      forgetMember: vi.fn(async () => {}),
    };
    const members = { forgetCached: vi.fn() };
    const handler = rolesPrivacy(store, members);
    expect(await handler.export?.(guildId, userId)).toEqual({
      membership: { joinedAt: new Date(0).toISOString(), leftAt: null, stickyRoleIds: [kept] },
      timeRoles: [{ roleId: timeRole, grantedAt: new Date(0).toISOString() }],
      temporaryRoles: [],
      activity: [{ day: '2026-11-01', messages: 4 }],
      activityRoles: [timeRole],
    });
    await handler.forget?.(guildId, userId);
    expect(store.forgetMember).toHaveBeenCalledWith(guildId, userId);
    expect(members.forgetCached).toHaveBeenCalledWith(guildId, userId);
  });

  it('exports nothing for strangers', async () => {
    const handler = rolesPrivacy(
      {
        member: async () => null,
        timeGranted: async () => [],
        temporaryFor: async () => [],
        activityFor: async () => ({ days: [], roleIds: [] }),
        forgetMember: async () => {},
      },
      { forgetCached() {} },
    );
    expect(await handler.export?.(guildId, userId)).toBeNull();
  });
});

describe('Menus and bots', () => {
  it('ignores reactions from bots', async () => {
    const menuByMessage = vi.fn(async () => null);
    const ctx = {
      config: async () => rolesConfig.parse({}),
      services: { platform: {}, log: { warn() {}, info() {}, debug() {}, error() {} } },
    } as unknown as ModuleContext<typeof rolesConfig>;
    const menus = new Menus(ctx, { menuByMessage } as unknown as RolesStore);
    await menus.onReaction(
      {
        guildId,
        channelId: '200000000000000001',
        messageId: '700000000000000001',
        userId,
        emoji: '⭐',
        bot: true,
      },
      true,
    );
    expect(menuByMessage).not.toHaveBeenCalled();
  });
});
