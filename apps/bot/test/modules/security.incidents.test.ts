import type { Job, Sql } from '@maxwell/core';
import { securityConfig } from '@maxwell/core/modules/security';
import type { AutomodStore } from '@maxwell/core/stores/automod';
import type { BackupStore } from '@maxwell/core/stores/backups';
import {
  type Incident,
  type IncidentEvent,
  type IncidentEventInput,
  type IncidentStore,
  type OpenInput,
  pickUndo,
  tally,
  UNDO_LIMIT,
  undoCandidates,
} from '@maxwell/core/stores/incidents';
import type { SecurityRaid, SecurityStore } from '@maxwell/core/stores/security';
import { describe, expect, it, vi } from 'vitest';
import { withLanguage } from '../../src/i18n/language.js';
import { Guard } from '../../src/modules/security/guard.js';
import {
  IncidentRecorder,
  incidentKind,
  readUndo,
  summary,
  timeoutSet,
} from '../../src/modules/security/incidents.js';
import { AuditAction } from '../../src/platform/types.js';
import type { ModuleContext } from '../../src/runtime/module.js';

const guildId = '900000000000000001';
const base = Date.UTC(2026, 9, 30, 21);

function event(
  kind: IncidentEvent['kind'],
  overrides: Partial<IncidentEvent> = {},
  at = base,
): IncidentEvent {
  return {
    id: String(Math.random()),
    kind,
    userId: null,
    actorId: null,
    byMaxwell: false,
    targetId: null,
    count: 1,
    detail: {},
    createdAt: new Date(at),
    ...overrides,
  };
}

class MemoryIncidents {
  incidents: Incident[] = [];
  rows = new Map<string, IncidentEvent[]>();
  #id = 0;

  async open(input: OpenInput) {
    const open = this.incidents.find((entry) => entry.guildId === input.guildId && !entry.endedAt);
    if (open) {
      open.raidId ??= input.raidId ?? null;
      if (open.endsAt && input.endsAt && input.endsAt > open.endsAt) open.endsAt = input.endsAt;
      return { incident: open, created: false };
    }
    const incident: Incident = {
      id: String(++this.#id),
      guildId: input.guildId,
      kind: input.kind,
      trigger: input.trigger ?? null,
      raidId: input.raidId ?? null,
      lockdownId: input.lockdownId ?? null,
      startedBy: input.startedBy,
      startedAt: input.startedAt ?? new Date(base),
      endsAt: input.endsAt,
      endedAt: null,
      endedBy: null,
      undoneAt: null,
      undoneBy: null,
    };
    this.incidents.push(incident);
    this.rows.set(incident.id, []);
    return { incident, created: true };
  }
  async active(g: string) {
    return this.incidents.find((entry) => entry.guildId === g && !entry.endedAt) ?? null;
  }
  async get(_g: string, id: string) {
    return this.incidents.find((entry) => entry.id === id) ?? null;
  }
  async close(_g: string, id: string, by: string | null) {
    const incident = this.incidents.find((entry) => entry.id === id && !entry.endedAt);
    if (!incident) return null;
    incident.endedAt = new Date(base + 10 * 60_000);
    incident.endedBy = by;
    return incident;
  }
  async markUndone(_g: string, id: string, by: string | null) {
    const incident = this.incidents.find((entry) => entry.id === id);
    if (incident) Object.assign(incident, { undoneAt: new Date(), undoneBy: by });
  }
  async add(incident: Incident, input: IncidentEventInput) {
    const list = this.rows.get(incident.id) ?? [];
    const existing = input.targetId
      ? list.find((entry) => entry.kind === input.kind && entry.targetId === input.targetId)
      : undefined;
    if (existing) {
      existing.actorId = input.actorId ?? existing.actorId;
      existing.byMaxwell = existing.byMaxwell || input.byMaxwell === true;
      existing.detail = { ...existing.detail, ...(input.detail ?? {}) };
      return;
    }
    list.push(
      event(
        input.kind,
        {
          id: String(list.length + 1),
          userId: input.userId ?? null,
          actorId: input.actorId ?? null,
          byMaxwell: input.byMaxwell ?? false,
          targetId: input.targetId ?? null,
          count: input.count ?? 1,
          detail: input.detail ?? {},
        },
        input.at?.getTime() ?? base,
      ),
    );
  }
  async deleted(incident: Incident, count: number) {
    await this.add(incident, { kind: 'delete', count });
  }
  async events(incident: Incident) {
    return this.rows.get(incident.id) ?? [];
  }
}

function harness() {
  let now = base;
  const config = securityConfig.parse({ logChannelId: '500000000000000001' });
  const platform = {
    selfId: '1',
    channelInGuild: async () => true,
    send: vi.fn(async () => '990000000000000001'),
    member: vi.fn(async (_g: string, userId: string) => ({
      guildId,
      user: { id: userId, username: `u${userId}`, displayName: `U${userId}`, bot: false },
      nick: null,
      roles: [],
      joinedAt: new Date(now),
      timeoutUntil: userId === '402' ? new Date(now + 60_000) : null,
    })),
    channels: vi.fn(async () => [{ id: '611', name: 'kept' }]),
    roles: vi.fn(async () => []),
  };
  const jobs = { enqueue: vi.fn(async () => '1') };
  const services = {
    platform,
    jobs,
    sql: (async () => []) as unknown as Sql,
    config: { DASHBOARD_URL: 'https://maxwell.example/' },
    log: { warn() {}, info() {}, debug() {}, error() {} },
  };
  const ctx = {
    config: async () => config,
    schedule: vi.fn(async () => '1'),
    record: vi.fn(async () => '1'),
    services,
  } as unknown as ModuleContext<typeof securityConfig>;
  const memory = new MemoryIncidents();
  const security = {
    lastScore: vi.fn(async () => 9),
    activeRaid: vi.fn(async () => null),
  };
  const automod = {
    activeIncident: vi.fn(async () => null),
    incident: vi.fn(async () => null),
  };
  const backups = {
    findChannel: vi.fn(async (_g: string, id: string) =>
      id === '613' ? null : { snapshotId: '31', channel: { id, name: `chan${id}` } },
    ),
    findRole: vi.fn(async (_g: string, id: string) => ({
      snapshotId: '32',
      role: { id, name: `role${id}` },
    })),
  };
  const guard = new Guard(ctx, automod as unknown as AutomodStore);
  const recorder = new IncidentRecorder(
    ctx,
    memory as unknown as IncidentStore,
    security as unknown as SecurityStore,
    automod as unknown as AutomodStore,
    backups as unknown as BackupStore,
    guard,
    () => now,
  );
  return {
    ctx,
    platform,
    jobs,
    memory,
    security,
    automod,
    recorder,
    tick: (ms: number) => {
      now += ms;
    },
    list: () => memory.rows.get(memory.incidents[0]?.id ?? '') ?? [],
  };
}

const raid: SecurityRaid = {
  id: '77',
  guildId,
  reason: 'joins',
  startedBy: null,
  startedAt: new Date(base),
  endsAt: new Date(base + 15 * 60_000),
  endedAt: null,
  endedBy: null,
  state: {},
};

function job(kind: string, payload: Record<string, unknown>): Job {
  return { id: '1', kind, guildId, payload, attempts: 1 } as unknown as Job;
}

describe('incident tally and undo selection', () => {
  it('counts what happened', () => {
    const counts = tally([
      event('join'),
      event('join'),
      event('ban'),
      event('delete', { count: 40 }),
      event('delete', { count: 2 }),
      event('hit'),
      event('channelDelete'),
      event('roleCreate'),
      event('lockdown'),
    ]);
    expect(counts).toEqual({
      joins: 2,
      bans: 1,
      kicks: 0,
      timeouts: 0,
      deleted: 42,
      hits: 1,
      channels: 1,
      roles: 1,
    });
  });

  it('offers only bans by Maxwell, running timeouts and lost channels and roles', () => {
    const events = [
      event('ban', { userId: '301', byMaxwell: true, detail: { name: 'raider' } }),
      event('ban', { userId: '302', actorId: '9' }),
      event('ban', { userId: '303' }),
      event('timeout', { userId: '401', detail: { until: new Date(base - 1).toISOString() } }),
      event('timeout', { userId: '402', detail: { until: new Date(base + 60_000).toISOString() } }),
      event('channelDelete', { targetId: '611', detail: { name: 'general' } }),
      event('channelDelete', { targetId: '612', detail: { restored: true } }),
      event('roleDelete', { targetId: '711' }),
      event('roleDelete', { targetId: '712' }),
      event('roleCreate', { targetId: '712' }),
    ];
    const candidates = undoCandidates(events, base);
    expect(candidates.bans).toEqual([{ userId: '301', name: 'raider', at: new Date(base) }]);
    expect(candidates.timeouts.map((entry) => entry.userId)).toEqual(['402']);
    expect(candidates.channels.map((entry) => entry.id)).toEqual(['611']);
    expect(candidates.roles.map((entry) => entry.id)).toEqual(['711']);
  });

  it('keeps only requested ids that are candidates', () => {
    const candidates = undoCandidates(
      [
        event('ban', { userId: '301', byMaxwell: true }),
        event('ban', { userId: '304', byMaxwell: true }),
        event('channelDelete', { targetId: '611' }),
      ],
      base,
    );
    expect(
      pickUndo(candidates, {
        bans: ['301', '301', '302'],
        timeouts: ['402'],
        channels: ['611', '999'],
        roles: [],
      }),
    ).toEqual({ bans: ['301'], timeouts: [], channels: ['611'], roles: [] });
    const many = undoCandidates(
      Array.from({ length: UNDO_LIMIT + 20 }, (_, i) =>
        event('ban', { userId: String(1000 + i), byMaxwell: true }),
      ),
      base,
    );
    const all = many.bans.map((entry) => entry.userId);
    expect(pickUndo(many, { bans: all, timeouts: [], channels: [], roles: [] }).bans).toHaveLength(
      UNDO_LIMIT,
    );
  });

  it('reads undo payloads defensively', () => {
    expect(
      readUndo({ bans: ['301', 'x', 5, '1'.repeat(30)], timeouts: 'nope', channels: ['611'] }),
    ).toEqual({ bans: ['301'], timeouts: [], channels: ['611'], roles: [] });
  });

  it('notices new timeouts only', () => {
    const until = new Date(base + 60_000);
    expect(timeoutSet({ timeoutUntil: until, before: null }, base)).toEqual(until);
    expect(
      timeoutSet(
        { timeoutUntil: until, before: { nick: null, roles: [], timeoutUntil: until } },
        base,
      ),
    ).toBeNull();
    expect(timeoutSet({ timeoutUntil: new Date(base - 1), before: null }, base)).toBeNull();
    expect(incidentKind({ kind: 'manual', userId: '9' })).toBe('manual');
    expect(incidentKind({ kind: 'wave', size: 5 })).toBe('raid');
  });
});

describe('incident recording', () => {
  it('opens on raid start with earlier joins and records what follows', async () => {
    const h = harness();
    await h.recorder.raidStarted(
      guildId,
      raid,
      { kind: 'joins', joins: 3, seconds: 10 },
      {
        id: null,
      },
      [
        { userId: '201', at: base - 5_000, createdAt: 0, name: 'early', hasAvatar: false },
        { userId: '202', at: base - 1_000, createdAt: 0, name: 'second', hasAvatar: false },
      ],
    );
    const incident = h.memory.incidents[0];
    expect(incident?.kind).toBe('raid');
    expect(incident?.startedAt.getTime()).toBe(base - 5_000);
    expect(h.ctx.schedule).toHaveBeenCalledWith(
      'incident.check',
      expect.objectContaining({ payload: { incidentId: incident?.id } }),
    );

    await h.recorder.onJoin({
      guildId,
      joinedAt: new Date(base),
      user: { id: '202', username: 'second', displayName: 'Second', bot: false, avatarUrl: '' },
    });
    await h.recorder.onBan({
      guildId,
      user: { id: '301', username: 'raider', displayName: 'Raider', bot: false, avatarUrl: '' },
    });
    await h.recorder.onAuditLog({
      id: 'a',
      guildId,
      action: AuditAction.MemberBanAdd,
      actorId: '1',
      targetId: '301',
      reason: null,
      changes: [],
    });
    await h.recorder.onAuditLog({
      id: 'b',
      guildId,
      action: AuditAction.MemberKick,
      actorId: '9',
      targetId: '302',
      reason: null,
      changes: [],
    });
    await h.recorder.onRemoved(guildId, 12);
    await h.recorder.onRemoved(null, 5);

    const events = h.list();
    expect(events.filter((entry) => entry.kind === 'join')).toHaveLength(2);
    expect(events.find((entry) => entry.userId === '202')?.detail).toMatchObject({ score: 9 });
    const ban = events.filter((entry) => entry.kind === 'ban');
    expect(ban).toHaveLength(1);
    expect(ban[0]).toMatchObject({ byMaxwell: true, actorId: null, detail: { name: 'Raider' } });
    expect(events.find((entry) => entry.kind === 'kick')).toMatchObject({ actorId: '9' });
    expect(tally(events).deleted).toBe(12);
  });

  it('records nothing outside an incident', async () => {
    const h = harness();
    await h.recorder.onBan({
      guildId,
      user: { id: '301', username: 'raider', displayName: 'Raider', bot: false, avatarUrl: '' },
    });
    expect(h.memory.incidents).toHaveLength(0);
  });

  it('turns a running lockdown into an incident', async () => {
    const h = harness();
    h.automod.activeIncident.mockResolvedValueOnce({
      id: '55',
      guildId,
      reason: 'raid',
      startedBy: null,
      startedAt: new Date(base - 60_000),
      endsAt: new Date(base + 60_000),
      endedAt: null,
      endedBy: null,
      held: 0,
    } as never);
    await h.recorder.onRemoved(guildId, 3);
    expect(h.memory.incidents[0]).toMatchObject({ kind: 'lockdown', lockdownId: '55' });
  });

  it('keeps nuke deletions with names and marks restored ones', async () => {
    const h = harness();
    await h.recorder.nukeStopped(guildId, {
      actorId: '7',
      key: 'channelDelete',
      count: 3,
      removed: 'ban',
      stripped: 1,
      deletedChannels: ['611', '612'],
      deletedRoles: ['711'],
      restored: ['612'],
    });
    const events = h.list();
    expect(h.memory.incidents[0]?.kind).toBe('nuke');
    expect(events.find((entry) => entry.kind === 'nuke')).toMatchObject({ actorId: '7' });
    expect(events.find((entry) => entry.targetId === '612')?.detail).toEqual({
      name: 'chan612',
      restored: true,
    });
    const candidates = undoCandidates(events, base);
    expect(candidates.channels.map((entry) => entry.id)).toEqual(['611']);
    expect(candidates.roles.map((entry) => entry.id)).toEqual(['711']);
  });

  it('posts a summary with a dashboard link when it ends', async () => {
    const h = harness();
    await h.recorder.raidStarted(guildId, raid, { kind: 'manual', userId: '9' }, { id: '9' });
    await h.recorder.onRemoved(guildId, 4);
    await h.recorder.raidEnded(guildId, { id: '9' });
    expect(h.memory.incidents[0]?.endedBy).toBe('9');
    const content = (
      h.platform.send.mock.calls.at(-1) as unknown as [string, { content: string }]
    )[1].content;
    expect(content).toContain('Raid over after 10 minutes.');
    expect(content).toContain('4 deleted messages');
    expect(content).toContain('https://maxwell.example/g/900000000000000001/security/incidents/1');
    expect(await h.recorder.current(guildId)).toBeNull();
  });

  it('closes a nuke incident once its window is over', async () => {
    const h = harness();
    await h.recorder.nukeStopped(guildId, {
      actorId: '7',
      key: 'ban',
      count: 5,
      removed: null,
      stripped: 0,
      deletedChannels: [],
      deletedRoles: [],
      restored: [],
    });
    const id = h.memory.incidents[0]?.id;
    await h.recorder.check(job('security.incident.check', { incidentId: id }));
    expect(h.memory.incidents[0]?.endedAt).toBeNull();
    h.tick(16 * 60_000);
    await h.recorder.check(job('security.incident.check', { incidentId: id }));
    expect(h.memory.incidents[0]?.endedAt).not.toBeNull();
  });

  it('writes the summary in german', () => {
    const incident = {
      kind: 'nuke',
      startedAt: new Date(base),
      endedAt: new Date(base + 3 * 60_000),
    } as Incident;
    const text = withLanguage('de', () => summary(incident, { ...tally([]), bans: 2 }, null));
    expect(text).toContain('Nuke vorbei nach 3 Minuten.');
    expect(text).toContain('2 Banns');
  });
});

describe('incident undo', () => {
  it('unbans, lifts running timeouts and restores only what was picked', async () => {
    const h = harness();
    await h.recorder.raidStarted(
      guildId,
      raid,
      { kind: 'joins', joins: 3, seconds: 10 },
      {
        id: null,
      },
    );
    const incident = h.memory.incidents[0] as Incident;
    for (const userId of ['301', '304']) {
      await h.memory.add(incident, { kind: 'ban', userId, targetId: userId, byMaxwell: true });
    }
    await h.memory.add(incident, { kind: 'ban', userId: '302', targetId: '302', actorId: '9' });
    for (const userId of ['401', '402']) {
      await h.memory.add(incident, {
        kind: 'timeout',
        userId,
        targetId: userId,
        detail: { until: new Date(base + 60_000).toISOString() },
      });
    }
    for (const id of ['611', '612', '613']) {
      await h.memory.add(incident, { kind: 'channelDelete', targetId: id });
    }

    await h.recorder.undo(
      job('security.incident.undo', {
        incidentId: incident.id,
        bans: ['301', '302'],
        timeouts: ['401', '402'],
        channels: ['611', '612', '613'],
        roles: [],
        by: '9',
      }),
    );

    const enqueued = h.jobs.enqueue.mock.calls.map(
      (call) => (call as unknown as [{ kind: string; payload: Record<string, unknown> }])[0],
    );
    const actions = enqueued
      .filter((entry) => entry.kind === 'moderation.action')
      .map((entry) => [entry.payload.action, entry.payload.userId, entry.payload.moderatorId]);
    expect(actions).toEqual([
      ['unban', '301', '9'],
      ['untimeout', '402', '9'],
    ]);
    const restore = enqueued.filter((entry) => entry.kind === 'backups.restore');
    expect(restore).toHaveLength(1);
    expect(restore[0]?.payload).toMatchObject({ snapshotId: '31', channels: ['612'], by: '9' });
    expect(incident.undoneBy).toBe('9');
    expect(h.ctx.record).toHaveBeenCalledWith(
      guildId,
      { id: '9' },
      'incident.undo',
      expect.stringContaining('3 actions'),
      expect.objectContaining({
        after: expect.objectContaining({ unbanned: ['301'], untimedOut: ['402'] }),
      }),
    );
  });

  it('does nothing when nothing picked is still undoable', async () => {
    const h = harness();
    await h.recorder.raidStarted(
      guildId,
      raid,
      { kind: 'joins', joins: 3, seconds: 10 },
      {
        id: null,
      },
    );
    const incident = h.memory.incidents[0] as Incident;
    await h.recorder.undo(
      job('security.incident.undo', { incidentId: incident.id, bans: ['301'], by: '9' }),
    );
    expect(h.jobs.enqueue).not.toHaveBeenCalled();
    expect(h.ctx.record).not.toHaveBeenCalled();
    expect(incident.undoneAt).toBeNull();
  });
});
