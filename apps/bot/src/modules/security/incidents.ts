import { type Actor, cancel, type Job } from '@maxwell/core';
import type { IncidentKind, NukeLimitKey } from '@maxwell/core/modules/security';
import type { AutomodStore } from '@maxwell/core/stores/automod';
import type { BackupStore } from '@maxwell/core/stores/backups';
import {
  type Incident,
  type IncidentEventInput,
  type IncidentStore,
  type IncidentTally,
  type OpenInput,
  pickUndo,
  tally,
  type UndoRequest,
  undoCandidates,
} from '@maxwell/core/stores/incidents';
import type { SecurityRaid, SecurityStore } from '@maxwell/core/stores/security';
import {
  AuditAction,
  type AuditLogEvent,
  type BanChange,
  type ChannelChange,
  type MemberJoin,
  type MemberUpdate,
  type RoleChange,
} from '../../platform/types.js';
import { andList, lines } from '../../ui/format.js';
import { audit, copy, reasons } from './copy.js';
import type { Ctx, Guard } from './guard.js';
import type { RaidTrigger } from './raid.js';
import type { JoinSample } from './risk.js';

const CACHE_TTL = 10_000;
const GUILD_CAP = 10_000;
const SCORE_WINDOW = 5 * 60_000;
const CHECK_MS = 5 * 60_000;
export const NUKE_MINUTES = 15;

const tallyOrder: (keyof IncidentTally)[] = [
  'joins',
  'bans',
  'kicks',
  'timeouts',
  'deleted',
  'hits',
  'channels',
  'roles',
];

const snowflake = /^\d{1,21}$/;

export function checkKey(incidentId: string): string {
  return `security.incident.check:${incidentId}`;
}

export function incidentKind(trigger: RaidTrigger): IncidentKind {
  return trigger.kind === 'manual' ? 'manual' : 'raid';
}

export function readUndo(payload: Record<string, unknown>): UndoRequest {
  const ids = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string' && snowflake.test(id))
      : [];
  return {
    bans: ids(payload.bans),
    timeouts: ids(payload.timeouts),
    channels: ids(payload.channels),
    roles: ids(payload.roles),
  };
}

export function timeoutSet(update: Pick<MemberUpdate, 'timeoutUntil' | 'before'>, now: number) {
  const next = update.timeoutUntil;
  if (!next || next.getTime() <= now) return null;
  const previous = update.before?.timeoutUntil ?? null;
  if (previous && previous.getTime() === next.getTime()) return null;
  return next;
}

function auditUntil(entry: AuditLogEvent, now: number): Date | null {
  const change = entry.changes.find((item) => item.key === 'communication_disabled_until');
  if (!change) return null;
  const { after } = change;
  const ms =
    typeof after === 'string' ? Date.parse(after) : typeof after === 'number' ? after : Number.NaN;
  return Number.isFinite(ms) && ms > now ? new Date(ms) : null;
}

export function summary(incident: Incident, counts: IncidentTally, url: string | null): string {
  const end = incident.endedAt ?? new Date();
  const minutes = Math.max(1, Math.round((end.getTime() - incident.startedAt.getTime()) / 60_000));
  const parts = tallyOrder
    .filter((key) => counts[key] > 0)
    .map((key) => copy.incident.parts[key](counts[key]));
  return lines(
    copy.incident.ended(copy.incident.kinds[incident.kind] ?? incident.kind, minutes),
    parts.length > 0 ? `${andList(parts)}.` : copy.incident.quiet,
    url ? copy.incident.replay(url) : null,
  );
}

export interface NukeReport {
  actorId: string;
  key: NukeLimitKey;
  count: number;
  removed: 'kick' | 'ban' | null;
  stripped: number;
  deletedChannels: readonly string[];
  deletedRoles: readonly string[];
  restored: readonly string[];
}

export class IncidentRecorder {
  readonly #cache = new Map<string, { incident: Incident | null; at: number }>();

  constructor(
    private readonly ctx: Ctx,
    private readonly store: IncidentStore,
    private readonly security: SecurityStore,
    private readonly automod: AutomodStore,
    private readonly backups: BackupStore,
    private readonly guard: Guard,
    private readonly now: () => number = Date.now,
  ) {}

  #remember(guildId: string, incident: Incident | null): void {
    this.#cache.delete(guildId);
    while (this.#cache.size >= GUILD_CAP) {
      const oldest = this.#cache.keys().next().value;
      if (oldest === undefined) break;
      this.#cache.delete(oldest);
    }
    this.#cache.set(guildId, { incident, at: this.now() });
  }

  async current(guildId: string): Promise<Incident | null> {
    const cached = this.#cache.get(guildId);
    if (cached && this.now() - cached.at < CACHE_TTL) return cached.incident;
    let incident = await this.store.active(guildId);
    if (!incident) {
      const lockdown = await this.automod.activeIncident(guildId).catch(() => null);
      if (lockdown && (!lockdown.endsAt || lockdown.endsAt.getTime() > this.now())) {
        incident = await this.open(guildId, {
          kind: 'lockdown',
          trigger: lockdown.reason,
          lockdownId: lockdown.id,
          startedBy: lockdown.startedBy,
          startedAt: lockdown.startedAt,
          endsAt: lockdown.endsAt,
        });
      }
    }
    this.#remember(guildId, incident);
    return incident;
  }

  async open(guildId: string, input: Omit<OpenInput, 'guildId'>): Promise<Incident> {
    const { incident, created } = await this.store.open({ ...input, guildId });
    this.#remember(guildId, incident);
    if (created) await this.#scheduleCheck(incident);
    return incident;
  }

  async #scheduleCheck(incident: Incident): Promise<void> {
    const due = incident.endsAt ? incident.endsAt.getTime() + 1_000 : this.now() + CHECK_MS;
    await cancel(this.ctx.services.sql, checkKey(incident.id)).catch(() => false);
    await this.ctx.schedule('incident.check', {
      guildId: incident.guildId,
      payload: { incidentId: incident.id },
      runAt: new Date(Math.max(due, this.now() + 1_000)),
      dedupeKey: checkKey(incident.id),
    });
  }

  async #record(guildId: string, input: IncidentEventInput): Promise<void> {
    const incident = await this.current(guildId);
    if (!incident) return;
    await this.store.add(incident, input);
  }

  async raidStarted(
    guildId: string,
    raid: SecurityRaid,
    trigger: RaidTrigger,
    by: Actor,
    recent: readonly JoinSample[] = [],
  ): Promise<Incident> {
    const first = Math.min(raid.startedAt.getTime(), ...recent.map((sample) => sample.at));
    const incident = await this.open(guildId, {
      kind: incidentKind(trigger),
      trigger: trigger.kind,
      raidId: raid.id,
      startedBy: by.id,
      startedAt: new Date(first),
      endsAt: raid.endsAt,
    });
    for (const sample of recent) {
      await this.store.add(incident, {
        kind: 'join',
        userId: sample.userId,
        targetId: sample.userId,
        detail: { name: sample.name },
        at: new Date(sample.at),
      });
    }
    return incident;
  }

  async raidEnded(guildId: string, by: Actor): Promise<Incident | null> {
    const incident = await this.store.active(guildId);
    if (!incident) {
      this.#remember(guildId, null);
      return null;
    }
    return this.close(incident, by);
  }

  async nukeStopped(guildId: string, report: NukeReport): Promise<Incident> {
    const endsAt = new Date(this.now() + NUKE_MINUTES * 60_000);
    const incident = await this.open(guildId, {
      kind: 'nuke',
      trigger: report.key,
      startedBy: null,
      endsAt,
    });
    if (incident.kind === 'nuke') await this.#scheduleCheck(incident);
    await this.store.add(incident, {
      kind: 'nuke',
      actorId: report.actorId,
      detail: {
        key: report.key,
        count: report.count,
        removed: report.removed,
        stripped: report.stripped,
      },
    });
    const restored = new Set(report.restored);
    for (const id of new Set(report.deletedChannels)) {
      const found = await this.backups.findChannel(guildId, id).catch(() => null);
      await this.store.add(incident, {
        kind: 'channelDelete',
        targetId: id,
        actorId: report.actorId,
        detail: {
          ...(found?.channel.name ? { name: found.channel.name } : {}),
          restored: restored.has(id),
        },
      });
    }
    for (const id of new Set(report.deletedRoles)) {
      const found = await this.backups.findRole(guildId, id).catch(() => null);
      await this.store.add(incident, {
        kind: 'roleDelete',
        targetId: id,
        actorId: report.actorId,
        detail: {
          ...(found?.role.name ? { name: found.role.name } : {}),
          restored: restored.has(id),
        },
      });
    }
    return incident;
  }

  async close(incident: Incident, by: Actor): Promise<Incident | null> {
    const closed = await this.store.close(incident.guildId, incident.id, by.id);
    this.#remember(incident.guildId, null);
    await cancel(this.ctx.services.sql, checkKey(incident.id)).catch(() => false);
    if (!closed) return null;
    const events = await this.store.events(closed);
    const config = await this.ctx.config(closed.guildId);
    const base = this.ctx.services.config.DASHBOARD_URL?.replace(/\/+$/, '');
    const url = base ? `${base}/g/${closed.guildId}/security/incidents/${closed.id}` : null;
    await this.guard.post(closed.guildId, config, {
      content: summary(closed, tally(events), url),
    });
    return closed;
  }

  async #until(incident: Incident, now: number): Promise<{ open: boolean; until: Date | null }> {
    const raid = await this.security.activeRaid(incident.guildId);
    if (raid) return { open: true, until: raid.endsAt };
    if (incident.kind === 'lockdown' && incident.lockdownId) {
      const lockdown = await this.automod.incident(incident.guildId, incident.lockdownId);
      const live =
        lockdown !== null &&
        lockdown.endedAt === null &&
        (lockdown.endsAt === null || lockdown.endsAt.getTime() > now);
      return { open: live, until: lockdown?.endsAt ?? null };
    }
    if (incident.kind === 'nuke' && incident.endsAt && incident.endsAt.getTime() > now) {
      return { open: true, until: incident.endsAt };
    }
    return { open: false, until: null };
  }

  async check(job: Job): Promise<void> {
    const incidentId = typeof job.payload.incidentId === 'string' ? job.payload.incidentId : null;
    if (!job.guildId || !incidentId) return;
    const incident = await this.store.get(job.guildId, incidentId);
    if (!incident || incident.endedAt) return;
    const now = this.now();
    const state = await this.#until(incident, now);
    if (!state.open) {
      await this.close(incident, { id: null });
      return;
    }
    const due = state.until ? state.until.getTime() + 1_000 : now + CHECK_MS;
    await this.ctx.schedule('incident.check', {
      guildId: incident.guildId,
      payload: { incidentId: incident.id },
      runAt: new Date(Math.max(due, now + 60_000)),
      dedupeKey: `${checkKey(incident.id)}:${now}`,
    });
  }

  async onJoin(join: MemberJoin): Promise<void> {
    const incident = await this.current(join.guildId);
    if (!incident) return;
    const score = join.user.bot
      ? null
      : await this.security
          .lastScore(join.guildId, join.user.id, new Date(this.now() - SCORE_WINDOW))
          .catch(() => null);
    await this.store.add(incident, {
      kind: 'join',
      userId: join.user.id,
      targetId: join.user.id,
      detail: {
        name: join.user.displayName || join.user.username,
        ...(score !== null ? { score } : {}),
        ...(join.user.bot ? { bot: true } : {}),
      },
    });
  }

  async onBan(change: BanChange): Promise<void> {
    await this.#record(change.guildId, {
      kind: 'ban',
      userId: change.user.id,
      targetId: change.user.id,
      detail: { name: change.user.displayName || change.user.username },
    });
  }

  async onMemberUpdate(update: MemberUpdate): Promise<void> {
    const until = timeoutSet(update, this.now());
    if (!until) return;
    await this.#record(update.guildId, {
      kind: 'timeout',
      userId: update.user.id,
      targetId: update.user.id,
      detail: { name: update.user.displayName || update.user.username, until: until.toISOString() },
    });
  }

  async onRemoved(guildId: string | null, count: number): Promise<void> {
    if (!guildId || count <= 0) return;
    const incident = await this.current(guildId);
    if (!incident) return;
    await this.store.deleted(incident, count);
  }

  async onChannel(kind: 'channelCreate' | 'channelDelete', change: ChannelChange): Promise<void> {
    await this.#record(change.guildId, {
      kind,
      targetId: change.channel.id,
      detail: change.channel.name ? { name: change.channel.name } : {},
    });
  }

  async onRole(kind: 'roleCreate' | 'roleDelete', change: RoleChange): Promise<void> {
    const name = change.role?.name ?? change.before?.name ?? null;
    await this.#record(change.guildId, {
      kind,
      targetId: change.roleId,
      detail: name ? { name } : {},
    });
  }

  async onAuditLog(entry: AuditLogEvent): Promise<void> {
    const selfId = this.ctx.services.platform.selfId;
    const byMaxwell = entry.actorId !== null && entry.actorId === selfId;
    const actorId = byMaxwell ? null : entry.actorId;
    const target = entry.targetId;
    if (!target) return;
    const kinds: Record<number, IncidentEventInput['kind']> = {
      [AuditAction.MemberBanAdd]: 'ban',
      [AuditAction.MemberKick]: 'kick',
      [AuditAction.ChannelCreate]: 'channelCreate',
      [AuditAction.ChannelDelete]: 'channelDelete',
      [AuditAction.RoleCreate]: 'roleCreate',
      [AuditAction.RoleDelete]: 'roleDelete',
    };
    if (entry.action === AuditAction.MemberUpdate) {
      const until = auditUntil(entry, this.now());
      if (!until) return;
      await this.#record(entry.guildId, {
        kind: 'timeout',
        userId: target,
        targetId: target,
        actorId,
        byMaxwell,
        detail: { until: until.toISOString() },
      });
      return;
    }
    const kind = kinds[entry.action];
    if (!kind) return;
    const member = kind === 'ban' || kind === 'kick';
    await this.#record(entry.guildId, {
      kind,
      userId: member ? target : null,
      targetId: target,
      actorId,
      byMaxwell,
    });
  }

  async undo(job: Job): Promise<void> {
    const guildId = job.guildId;
    const incidentId = typeof job.payload.incidentId === 'string' ? job.payload.incidentId : null;
    if (!guildId || !incidentId) return;
    const by = typeof job.payload.by === 'string' ? job.payload.by : null;
    const incident = await this.store.get(guildId, incidentId);
    if (!incident) return;
    const { platform, jobs } = this.ctx.services;
    const events = await this.store.events(incident);
    const picked = pickUndo(undoCandidates(events, this.now()), readUndo(job.payload));
    const reason = reasons.incidentUndo(incident.id);

    for (const userId of picked.bans) {
      await jobs.enqueue({
        kind: 'moderation.action',
        guildId,
        payload: { action: 'unban', userId, moderatorId: by, reason, source: 'security' },
      });
    }
    const timeouts: string[] = [];
    for (const userId of picked.timeouts) {
      const member = await platform.member(guildId, userId).catch(() => null);
      if (!member?.timeoutUntil || member.timeoutUntil.getTime() <= this.now()) continue;
      timeouts.push(userId);
      await jobs.enqueue({
        kind: 'moderation.action',
        guildId,
        payload: { action: 'untimeout', userId, moderatorId: by, reason, source: 'security' },
      });
    }
    const restored = await this.#restore(guildId, picked.channels, picked.roles, by);

    const done = picked.bans.length + timeouts.length + restored.channels + restored.roles;
    if (done === 0) return;
    await this.store.markUndone(guildId, incident.id, by);
    await this.ctx.record(
      guildId,
      { id: by },
      'incident.undo',
      audit.incidentUndo(incident.id, done),
      {
        after: {
          incidentId: incident.id,
          unbanned: picked.bans,
          untimedOut: timeouts,
          channels: restored.channelIds,
          roles: restored.roleIds,
        },
      },
    );
  }

  async #restore(
    guildId: string,
    channelIds: readonly string[],
    roleIds: readonly string[],
    by: string | null,
  ): Promise<{ channels: number; roles: number; channelIds: string[]; roleIds: string[] }> {
    const { platform, jobs } = this.ctx.services;
    const [channels, roles] = await Promise.all([
      channelIds.length > 0 ? platform.channels(guildId).catch(() => null) : [],
      roleIds.length > 0 ? platform.roles(guildId).catch(() => null) : [],
    ]);
    const plans = new Map<string, { roles: string[]; channels: string[] }>();
    const plan = (snapshotId: string) => {
      const entry = plans.get(snapshotId) ?? { roles: [], channels: [] };
      plans.set(snapshotId, entry);
      return entry;
    };
    for (const id of channelIds) {
      if (!channels || channels.some((channel) => channel.id === id)) continue;
      const found = await this.backups.findChannel(guildId, id).catch(() => null);
      if (found) plan(found.snapshotId).channels.push(id);
    }
    for (const id of roleIds) {
      if (!roles || roles.some((role) => role.id === id)) continue;
      const found = await this.backups.findRole(guildId, id).catch(() => null);
      if (found) plan(found.snapshotId).roles.push(id);
    }
    const result = { channels: 0, roles: 0, channelIds: [] as string[], roleIds: [] as string[] };
    for (const [snapshotId, entry] of plans) {
      result.channels += entry.channels.length;
      result.roles += entry.roles.length;
      result.channelIds.push(...entry.channels);
      result.roleIds.push(...entry.roles);
      await jobs.enqueue({
        kind: 'backups.restore',
        guildId,
        payload: {
          snapshotId,
          scope: 'pick',
          roles: entry.roles,
          channels: entry.channels,
          modules: [],
          by,
        },
      });
    }
    return result;
  }

  forget(guildId: string): void {
    this.#cache.delete(guildId);
  }
}
