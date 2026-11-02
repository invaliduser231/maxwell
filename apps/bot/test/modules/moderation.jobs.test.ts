import type { Job } from '@maxwell/core';
import { moderationConfig } from '@maxwell/core/modules/moderation';
import { ShieldStore } from '@maxwell/core/stores/shield';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChannelTools } from '../../src/modules/moderation/channels.js';
import { registerJobs } from '../../src/modules/moderation/jobs.js';
import { massBan, postMassBanSummary } from '../../src/modules/moderation/massban.js';
import type { ActInput, ModerationService } from '../../src/modules/moderation/service.js';
import type { MemberRef, RoleRef } from '../../src/platform/types.js';
import type { JobHandler } from '../../src/runtime/scheduler.js';

vi.mock('../../src/modules/moderation/massban.js', () => ({
  massBan: vi.fn(async (_moderation: unknown, input: { userIds: string[] }) => ({
    banned: input.userIds.map((userId, index) => ({ userId, number: index + 1 })),
    skipped: [],
    failed: [],
  })),
  postMassBanSummary: vi.fn(async () => {}),
}));

const guild = '900000000000000001';
const self = '100000000000000001';
const operator = '200000000000000001';
const admin = '300000000000000001';
const junior = '300000000000000002';
const senior = '300000000000000003';
const boss = '500000000000000001';
const plain = '500000000000000002';
const gone = '500000000000000003';

const roles = [
  { id: 'r-low', position: 1 },
  { id: 'r-junior', position: 2 },
  { id: 'r-senior', position: 5 },
  { id: 'r-admin', position: 7 },
  { id: 'r-bot', position: 9 },
] as RoleRef[];

const admins = [admin, boss];
const until = new Date(Date.now() + 3_600_000);

const memberOf = (id: string): MemberRef | null => {
  const ids: Record<string, string[]> = {
    [self]: ['r-bot'],
    [admin]: ['r-admin'],
    [junior]: ['r-junior'],
    [senior]: ['r-senior'],
    [boss]: ['r-low'],
    [plain]: ['r-low'],
  };
  const list = ids[id];
  return list
    ? ({
        userId: id,
        roles: list,
        timeoutUntil: id === junior ? until : null,
      } as unknown as MemberRef)
    : null;
};

function setup(owners: string[] = []) {
  const handlers = new Map<string, JobHandler>();
  const acted: ActInput[] = [];
  const warnings: { data: Record<string, unknown>; message: string }[] = [];
  const lookups: string[] = [];
  const scheduled: { kind: string; payload: Record<string, unknown> }[] = [];
  const platform = {
    selfId: self,
    member: async (_g: string, id: string) => {
      lookups.push('member');
      return memberOf(id);
    },
    roles: async () => {
      lookups.push('roles');
      return roles;
    },
    hasPermissions: async (_g: string, id: string) => {
      lookups.push('permissions');
      return admins.includes(id);
    },
  };
  const ctx = {
    services: {
      platform,
      log: {
        warn: (data: Record<string, unknown>, message: string) =>
          void warnings.push({ data, message }),
        info: () => {},
      },
      sql: {},
      modules: {},
      config: { OWNER_IDS: owners },
    },
    job: (kind: string, handler: JobHandler) => void handlers.set(kind, handler),
    schedule: async (kind: string, options: { payload: Record<string, unknown> }) => {
      scheduled.push({ kind, payload: options.payload });
      return null;
    },
    on: () => {},
    undo: () => {},
  };
  const moderation = {
    ctx,
    store: {},
    config: async () => moderationConfig.parse({}),
    act: async (input: ActInput) => {
      acted.push(input);
      return { row: { action: input.action } };
    },
  } as unknown as ModerationService;
  registerJobs(moderation, {} as ChannelTools);
  const run = (payload: Record<string, unknown>, kind = 'action') => {
    const handler = handlers.get(kind) as JobHandler;
    const job: Job = {
      id: '1',
      kind: `moderation.${kind}`,
      guildId: guild,
      payload,
      runAt: new Date(),
      attempts: 1,
    };
    return handler(job);
  };
  return { run, acted, warnings, lookups, scheduled };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(massBan).mockClear();
  vi.mocked(postMassBanSummary).mockClear();
});

describe('moderation action job', () => {
  it('refuses a dashboard ban on an administrator', async () => {
    const { run, acted, warnings } = setup();
    await run({ action: 'ban', userId: boss, moderatorId: junior, by: junior });
    expect(acted).toEqual([]);
    expect(warnings).toEqual([
      {
        data: expect.objectContaining({ guild, action: 'ban', problem: 'admin' }),
        message: 'dashboard action refused',
      },
    ]);
  });

  it('refuses dashboard kicks and timeouts on members ranked at or above the user', async () => {
    const { run, acted, warnings } = setup();
    await run({ action: 'kick', userId: senior, moderatorId: junior, by: junior });
    await run({
      action: 'timeout',
      userId: senior,
      moderatorId: junior,
      durationSeconds: 600,
      by: junior,
    });
    expect(acted).toEqual([]);
    expect(warnings.map((entry) => entry.data.problem)).toEqual(['higher', 'higher']);
  });

  it('records the dashboard user instead of the payload moderator', async () => {
    const report = vi.spyOn(ShieldStore.prototype, 'report').mockResolvedValue(true);
    const { run, acted } = setup();
    await run({ action: 'ban', userId: plain, moderatorId: senior, shield: true, by: junior });
    expect(acted).toEqual([
      expect.objectContaining({
        action: 'ban',
        userId: plain,
        moderatorId: junior,
        source: 'dashboard',
      }),
    ]);
    expect(report).toHaveBeenCalledWith(guild, plain, 'manual', junior);
  });

  it('lets admins act on higher roles and members lift their own timeout', async () => {
    const { run, acted, warnings } = setup();
    await run({ action: 'kick', userId: senior, moderatorId: admin, by: admin });
    await run({ action: 'untimeout', userId: junior, moderatorId: junior, by: junior });
    await run({ action: 'unban', userId: gone, moderatorId: junior, by: junior });
    expect(warnings).toEqual([]);
    expect(acted).toEqual([
      expect.objectContaining({ action: 'kick', userId: senior, moderatorId: admin }),
      expect.objectContaining({
        action: 'untimeout',
        userId: junior,
        moderatorId: junior,
        previousUntil: until,
      }),
      expect.objectContaining({ action: 'unban', userId: gone, moderatorId: junior }),
    ]);
  });

  it('lets bot operators act on ranked members without being in the community', async () => {
    const { run, acted, warnings } = setup([operator]);
    await run({ action: 'ban', userId: senior, moderatorId: operator, by: operator });
    await run({ action: 'kick', userId: boss, moderatorId: operator, by: operator });
    expect(warnings).toEqual([]);
    expect(acted).toEqual([
      expect.objectContaining({ action: 'ban', userId: senior, moderatorId: operator }),
      expect.objectContaining({ action: 'kick', userId: boss, moderatorId: operator }),
    ]);
  });

  it('runs bot-internal actions as before', async () => {
    const { run, acted, warnings, lookups } = setup();
    await run({ action: 'warn', userId: senior, moderatorId: null, source: 'automod' });
    await run({
      action: 'ban',
      userId: boss,
      reason: 'raid',
      source: 'security',
      deleteMessageSeconds: 86_400,
    });
    await run({ action: 'unban', userId: boss, moderatorId: admin, source: 'security' });
    expect(warnings).toEqual([]);
    expect(lookups).toEqual([]);
    expect(acted).toEqual([
      expect.objectContaining({
        action: 'warn',
        userId: senior,
        moderatorId: null,
        source: 'automod',
      }),
      expect.objectContaining({
        action: 'ban',
        userId: boss,
        moderatorId: null,
        source: 'security',
        deleteMessageSeconds: 86_400,
      }),
      expect.objectContaining({
        action: 'unban',
        userId: boss,
        moderatorId: admin,
        source: 'security',
      }),
    ]);
  });
});

describe('mass ban job', () => {
  const many = Array.from({ length: 60 }, (_, index) =>
    String(600000000000000000n + BigInt(index)),
  );

  it('acts as the dashboard user, not the payload moderator', async () => {
    const { run, scheduled } = setup();
    await run({ userIds: many, moderatorId: senior, by: junior }, 'massban');
    expect(vi.mocked(massBan).mock.calls[0]?.[1]).toMatchObject({ moderatorId: junior });
    expect(scheduled[0]?.payload).toMatchObject({ moderatorId: junior, by: junior });
  });

  it('keeps running continuations queued without a dashboard user', async () => {
    const { run } = setup();
    await run({ userIds: [plain], moderatorId: junior, batch: 'b1', total: 51 }, 'massban');
    expect(vi.mocked(massBan).mock.calls[0]?.[1]).toMatchObject({ moderatorId: junior });
    expect(vi.mocked(postMassBanSummary).mock.calls[0]?.[1]).toMatchObject({
      moderatorId: junior,
    });
  });

  it('refuses a fresh mass ban without a dashboard user', async () => {
    const { run, warnings } = setup();
    await run({ userIds: [plain], moderatorId: junior }, 'massban');
    expect(massBan).not.toHaveBeenCalled();
    expect(warnings.map((entry) => entry.message)).toEqual(['mass ban without a known moderator']);
  });

  it('still rejects a payload without a moderator', async () => {
    const { run, warnings } = setup();
    await run({ userIds: [plain], by: junior }, 'massban');
    expect(massBan).not.toHaveBeenCalled();
    expect(warnings.map((entry) => entry.message)).toEqual(['invalid mass ban payload']);
  });
});
