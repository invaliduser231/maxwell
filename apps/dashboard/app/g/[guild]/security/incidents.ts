import 'server-only';
import { BackupStore } from '@maxwell/core/stores/backups';
import {
  type Incident,
  IncidentStore,
  type IncidentTally,
  undoCandidates,
} from '@maxwell/core/stores/incidents';
import { db } from '@/lib/db';
import { guildChannels, guildRoles } from '@/lib/fluxer';
import { people, personOf } from '@/lib/people';

export interface IncidentRow {
  id: string;
  kind: string;
  trigger: string | null;
  startedAt: number;
  endedAt: number | null;
  undone: boolean;
  tally: IncidentTally;
}

export interface IncidentHead extends Omit<IncidentRow, 'tally'> {
  startedBy: string | null;
  undoneAt: number | null;
  undoneBy: string | null;
}

export interface TimelineEvent {
  id: string;
  kind: string;
  at: number;
  user: string | null;
  actor: string | null;
  byMaxwell: boolean;
  count: number;
  name: string | null;
  score: number | null;
  rule: string | null;
  on: boolean | null;
  key: string | null;
  restored: boolean;
}

export interface UndoEntry {
  id: string;
  name: string;
  at: number;
}

export interface UndoView {
  bans: UndoEntry[];
  timeouts: UndoEntry[];
  channels: UndoEntry[];
  roles: UndoEntry[];
}

export interface IncidentDetail {
  now: number;
  incident: IncidentHead;
  events: TimelineEvent[];
  undo: UndoView;
}

function head(incident: Incident) {
  return {
    id: incident.id,
    kind: incident.kind,
    trigger: incident.trigger,
    startedAt: incident.startedAt.getTime(),
    endedAt: incident.endedAt?.getTime() ?? null,
    undone: incident.undoneAt !== null,
  };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function incidentRows(guildId: string): Promise<IncidentRow[]> {
  const rows = await new IncidentStore(db().sql).list(guildId, 20);
  return rows.map((row) => ({ ...head(row), tally: row.tally }));
}

export async function incidentDetail(guildId: string, id: string): Promise<IncidentDetail | null> {
  const { sql } = db();
  const store = new IncidentStore(sql);
  const incident = await store.get(guildId, id);
  if (!incident) return null;
  const now = Date.now();
  const events = await store.events(incident);
  const candidates = undoCandidates(events, now);
  const backups = new BackupStore(sql);
  const [channels, roles] = await Promise.all([
    candidates.channels.length > 0 ? guildChannels(guildId).catch(() => null) : [],
    candidates.roles.length > 0 ? guildRoles(guildId).catch(() => null) : [],
  ]);
  const restorableChannels = [];
  for (const entry of candidates.channels.slice(0, 50)) {
    if (!channels || channels.some((channel) => channel.id === entry.id)) continue;
    if (await backups.findChannel(guildId, entry.id).catch(() => null)) {
      restorableChannels.push(entry);
    }
  }
  const restorableRoles = [];
  for (const entry of candidates.roles.slice(0, 50)) {
    if (!roles || roles.some((role) => role.id === entry.id)) continue;
    if (await backups.findRole(guildId, entry.id).catch(() => null)) restorableRoles.push(entry);
  }

  const names = await people([
    incident.startedBy,
    incident.undoneBy,
    ...events.flatMap((event) => [event.actorId, text(event.detail.name) ? null : event.userId]),
  ]);
  const nameOf = (userId: string | null, stored: unknown) =>
    text(stored) ?? (userId ? personOf(names, userId).name : null);

  return {
    now,
    incident: {
      ...head(incident),
      startedBy: incident.startedBy ? personOf(names, incident.startedBy).name : null,
      undoneAt: incident.undoneAt?.getTime() ?? null,
      undoneBy: incident.undoneBy ? personOf(names, incident.undoneBy).name : null,
    },
    events: events.map((event) => ({
      id: event.id,
      kind: event.kind,
      at: event.createdAt.getTime(),
      user: nameOf(event.userId, event.detail.name),
      actor: event.actorId ? personOf(names, event.actorId).name : null,
      byMaxwell: event.byMaxwell,
      count: event.count,
      name: event.userId ? null : text(event.detail.name),
      score: typeof event.detail.score === 'number' ? event.detail.score : null,
      rule: text(event.detail.rule),
      on: typeof event.detail.on === 'boolean' ? event.detail.on : null,
      key: text(event.detail.key),
      restored: event.detail.restored === true,
    })),
    undo: {
      bans: candidates.bans.map((entry) => ({
        id: entry.userId,
        name: nameOf(entry.userId, entry.name) ?? entry.userId,
        at: entry.at.getTime(),
      })),
      timeouts: candidates.timeouts.map((entry) => ({
        id: entry.userId,
        name: nameOf(entry.userId, entry.name) ?? entry.userId,
        at: entry.at.getTime(),
      })),
      channels: restorableChannels.map((entry) => ({
        id: entry.id,
        name: entry.name ?? entry.id,
        at: entry.at.getTime(),
      })),
      roles: restorableRoles.map((entry) => ({
        id: entry.id,
        name: entry.name ?? entry.id,
        at: entry.at.getTime(),
      })),
    },
  };
}
