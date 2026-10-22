import type { Job } from '@maxwell/core';
import { welcomeConfig } from '@maxwell/core/modules/welcome';
import type { WelcomeStore } from '@maxwell/core/stores/welcome';
import { describe, expect, it, vi } from 'vitest';
import { HOLD_SETTLE, type Holds, waitKey, waitPrefix } from '../../src/modules/roles/held.js';
import { RulesGate, welcomePrivacy } from '../../src/modules/welcome/gate.js';
import type { ReactionEvent } from '../../src/platform/types.js';
import type { ModuleContext } from '../../src/runtime/module.js';

const guildId = '900000000000000001';
const userId = '300000000000000001';
const rulesRole = '100000000000000001';
const later = '100000000000000002';
const gateRole = '100000000000000009';
const rulesMessage = '700000000000000001';

function setup(
  options: { held?: boolean; watching?: boolean; accepted?: boolean; rules?: boolean } = {},
) {
  const config = welcomeConfig.parse({
    rules: options.rules === false ? {} : { enabled: true, roleId: rulesRole, emoji: '✅' },
    delayedRoles: [{ roleId: later, delayMinutes: 10 }],
  });
  const calls: string[] = [];
  const platform = {
    member: vi.fn(async () => ({
      guildId,
      user: { id: userId, username: 'lena', displayName: 'Lena', bot: false, avatarUrl: '' },
      nick: null,
      roles: options.held ? [gateRole] : [],
      joinedAt: new Date(),
      timeoutUntil: null,
    })),
    addRole: vi.fn(async (_g: string, _u: string, roleId: string) => {
      calls.push(`add ${roleId}`);
    }),
    removeRole: vi.fn(async () => {}),
  };
  const store = {
    rulesMessage: vi.fn(async () => ({
      channelId: '200000000000000001',
      messageId: rulesMessage,
      publishedAt: new Date(),
    })),
    accept: vi.fn(async () => true),
    hasAccepted: vi.fn(async () => options.accepted ?? false),
    revoke: vi.fn(async () => {}),
  };
  const holds = {
    watching: vi.fn(async () => options.watching ?? false),
    gateRole: vi.fn(async () => gateRole),
    held: vi.fn(async () => options.held ?? false),
    wake: vi.fn(async () => {}),
  } satisfies Holds;
  const schedule = vi.fn(async () => '1');
  const ctx = {
    config: async () => config,
    enabled: async () => true,
    schedule,
    record: vi.fn(async () => '1'),
    services: { platform, log: { warn() {}, info() {}, debug() {}, error() {} } },
  } as unknown as ModuleContext<typeof welcomeConfig>;
  const gateUnderTest = new RulesGate(ctx, store as unknown as WelcomeStore, holds);
  return { gate: gateUnderTest, config, calls, store, holds, schedule };
}

function reaction(bot = false): ReactionEvent {
  return {
    guildId,
    channelId: '200000000000000001',
    messageId: rulesMessage,
    userId,
    emoji: '✅',
    bot,
  };
}

function job(kind: string, payload: Record<string, unknown>): Job {
  return { id: '1', kind, guildId, payload, runAt: new Date(), attempts: 1 };
}

describe('RulesGate', () => {
  it('gives the rules role on the reaction', async () => {
    const { gate, config, calls, schedule } = setup();
    await gate.onReaction(reaction(), config, true);
    expect(calls).toEqual([`add ${rulesRole}`]);
    expect(schedule).toHaveBeenCalledWith(
      'roles.grant',
      expect.objectContaining({ payload: expect.objectContaining({ roleIds: [later] }) }),
    );
  });

  it('ignores reactions from bots', async () => {
    const { gate, config, calls, store } = setup();
    await gate.onReaction(reaction(true), config, true);
    expect(calls).toEqual([]);
    expect(store.rulesMessage).not.toHaveBeenCalled();
  });

  it('notes the acceptance of a held member without letting them in', async () => {
    const { gate, config, calls, store, schedule } = setup({ held: true });
    await gate.onReaction(reaction(), config, true);
    expect(calls).toEqual([]);
    expect(store.accept).toHaveBeenCalledWith(guildId, userId);
    expect(schedule).not.toHaveBeenCalled();
  });

  it('waits for the raid shield before giving a returning member the role', async () => {
    const { gate, config, calls, schedule } = setup({ accepted: true, watching: true });
    const at = Date.now();
    await gate.onJoin(guildId, userId, config, at);
    expect(calls).toEqual([]);
    expect(schedule).toHaveBeenCalledWith(
      'rules.restore',
      expect.objectContaining({ payload: { userId, since: at } }),
    );
    const runAt = (schedule.mock.calls[0] as unknown[])[1] as { runAt: Date };
    expect(runAt.runAt.getTime()).toBeGreaterThanOrEqual(at + HOLD_SETTLE);
  });

  it('gives a returning member the role right away when nothing is watching', async () => {
    const { gate, config, calls } = setup({ accepted: true });
    await gate.onJoin(guildId, userId, config, Date.now());
    expect(calls).toEqual([`add ${rulesRole}`]);
  });

  it('keeps a held returning member waiting', async () => {
    const { gate, calls, schedule } = setup({ accepted: true, held: true });
    await gate.restoreJob(job('welcome.rules.restore', { userId, since: Date.now() }));
    expect(calls).toEqual([]);
    expect(schedule).toHaveBeenCalledWith(
      'rules.restore',
      expect.objectContaining({ dedupeKey: waitKey('welcome', guildId, userId, 'rules') }),
    );
  });

  it('holds back delayed roles while held', async () => {
    const { gate, calls, schedule } = setup({ rules: false, held: true });
    await gate.grantDelayed(
      job('welcome.roles.grant', { userId, roleIds: [later], since: Date.now(), minutes: 10 }),
    );
    expect(calls).toEqual([]);
    expect(schedule).toHaveBeenCalledWith(
      'roles.grant',
      expect.objectContaining({ dedupeKey: waitKey('welcome', guildId, userId, 'roles:10') }),
    );

    const free = setup({ rules: false });
    await free.gate.grantDelayed(job('welcome.roles.grant', { userId, roleIds: [later] }));
    expect(free.calls).toEqual([`add ${later}`]);
  });

  it('lets an accepted member in once the gate opens', async () => {
    const { gate, holds, schedule } = setup({ accepted: true });
    await gate.onMemberUpdate({
      guildId,
      user: { id: userId, username: 'lena', displayName: 'Lena', bot: false, avatarUrl: '' },
      nick: null,
      roles: [],
      timeoutUntil: null,
      before: { nick: null, roles: [gateRole], timeoutUntil: null },
    });
    expect(holds.wake).toHaveBeenCalledWith(waitPrefix('welcome', guildId, userId));
    expect(schedule).toHaveBeenCalledWith(
      'rules.restore',
      expect.objectContaining({ dedupeKey: waitKey('welcome', guildId, userId, 'rules') }),
    );
  });

  it('does nothing on unrelated role changes', async () => {
    const { gate, holds, schedule } = setup({ accepted: true });
    await gate.onMemberUpdate({
      guildId,
      user: { id: userId, username: 'lena', displayName: 'Lena', bot: false, avatarUrl: '' },
      nick: null,
      roles: [],
      timeoutUntil: null,
      before: { nick: null, roles: [later], timeoutUntil: null },
    });
    expect(holds.wake).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe('welcome privacy', () => {
  it('exports and forgets the rules acceptance', async () => {
    const store = {
      acceptedAt: vi.fn(async () => new Date(0)),
      revoke: vi.fn(async () => {}),
    };
    const handler = welcomePrivacy(store);
    expect(await handler.export?.(guildId, userId)).toEqual({
      rulesAcceptedAt: new Date(0).toISOString(),
    });
    await handler.forget?.(guildId, userId);
    expect(store.revoke).toHaveBeenCalledWith(guildId, userId);
    store.acceptedAt.mockResolvedValueOnce(null as unknown as Date);
    expect(await handler.export?.(guildId, userId)).toBeNull();
  });
});
