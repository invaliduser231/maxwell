import type { Sql } from '../db/sql.js';
import type { IncidentKind } from '../modules/security.js';

export type IncidentEventKind =
  | 'join'
  | 'ban'
  | 'kick'
  | 'timeout'
  | 'delete'
  | 'channelDelete'
  | 'channelCreate'
  | 'roleDelete'
  | 'roleCreate'
  | 'nuke'
  | 'hit'
  | 'lockdown';

export interface Incident {
  id: string;
  guildId: string;
  kind: IncidentKind;
  trigger: string | null;
  raidId: string | null;
  lockdownId: string | null;
  startedBy: string | null;
  startedAt: Date;
  endsAt: Date | null;
  endedAt: Date | null;
  endedBy: string | null;
  undoneAt: Date | null;
  undoneBy: string | null;
}

export interface IncidentEvent {
  id: string;
  kind: IncidentEventKind;
  userId: string | null;
  actorId: string | null;
  byMaxwell: boolean;
  targetId: string | null;
  count: number;
  detail: Record<string, unknown>;
  createdAt: Date;
}

export interface IncidentEventInput {
  kind: IncidentEventKind;
  userId?: string | null;
  actorId?: string | null;
  byMaxwell?: boolean;
  targetId?: string | null;
  count?: number;
  detail?: Record<string, unknown>;
  at?: Date;
}

export interface IncidentTally {
  joins: number;
  bans: number;
  kicks: number;
  timeouts: number;
  deleted: number;
  hits: number;
  channels: number;
  roles: number;
}

export interface IncidentSummary extends Incident {
  tally: IncidentTally;
}

export interface OpenInput {
  guildId: string;
  kind: IncidentKind;
  trigger?: string | null;
  raidId?: string | null;
  lockdownId?: string | null;
  startedBy: string | null;
  startedAt?: Date;
  endsAt: Date | null;
}

export interface UndoMember {
  userId: string;
  name: string | null;
  at: Date;
}

export interface UndoTarget {
  id: string;
  name: string | null;
  at: Date;
}

export interface UndoCandidates {
  bans: UndoMember[];
  timeouts: UndoMember[];
  channels: UndoTarget[];
  roles: UndoTarget[];
}

export interface UndoRequest {
  bans: readonly string[];
  timeouts: readonly string[];
  channels: readonly string[];
  roles: readonly string[];
}

export const TIMELINE_LIMIT = 2_000;
export const UNDO_LIMIT = 500;
const DELETE_MERGE_SECONDS = 10;

const emptyTally = (): IncidentTally => ({
  joins: 0,
  bans: 0,
  kicks: 0,
  timeouts: 0,
  deleted: 0,
  hits: 0,
  channels: 0,
  roles: 0,
});

export function tally(events: readonly Pick<IncidentEvent, 'kind' | 'count'>[]): IncidentTally {
  const result = emptyTally();
  for (const event of events) {
    switch (event.kind) {
      case 'join':
        result.joins++;
        break;
      case 'ban':
        result.bans++;
        break;
      case 'kick':
        result.kicks++;
        break;
      case 'timeout':
        result.timeouts++;
        break;
      case 'delete':
        result.deleted += event.count;
        break;
      case 'hit':
        result.hits++;
        break;
      case 'channelDelete':
      case 'channelCreate':
        result.channels++;
        break;
      case 'roleDelete':
      case 'roleCreate':
        result.roles++;
        break;
      default:
        break;
    }
  }
  return result;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function untilOf(event: IncidentEvent): number | null {
  const until = text(event.detail.until);
  if (!until) return null;
  const ms = Date.parse(until);
  return Number.isFinite(ms) ? ms : null;
}

export function undoCandidates(events: readonly IncidentEvent[], now = Date.now()): UndoCandidates {
  const bans = new Map<string, UndoMember>();
  const timeouts = new Map<string, UndoMember>();
  const channels = new Map<string, UndoTarget>();
  const roles = new Map<string, UndoTarget>();
  for (const event of events) {
    const name = text(event.detail.name);
    if (event.kind === 'ban' && event.byMaxwell && event.userId) {
      bans.set(event.userId, { userId: event.userId, name, at: event.createdAt });
    } else if (event.kind === 'timeout' && event.userId) {
      const until = untilOf(event);
      if (until !== null && until > now) {
        timeouts.set(event.userId, { userId: event.userId, name, at: event.createdAt });
      } else {
        timeouts.delete(event.userId);
      }
    } else if (
      (event.kind === 'channelDelete' || event.kind === 'roleDelete') &&
      event.targetId &&
      event.detail.restored !== true
    ) {
      const list = event.kind === 'channelDelete' ? channels : roles;
      list.set(event.targetId, { id: event.targetId, name, at: event.createdAt });
    } else if (event.kind === 'channelCreate' && event.targetId) {
      channels.delete(event.targetId);
    } else if (event.kind === 'roleCreate' && event.targetId) {
      roles.delete(event.targetId);
    }
  }
  return {
    bans: [...bans.values()],
    timeouts: [...timeouts.values()],
    channels: [...channels.values()],
    roles: [...roles.values()],
  };
}

export function pickUndo(candidates: UndoCandidates, request: UndoRequest): UndoRequest {
  const keep = (allowed: readonly string[], wanted: readonly string[]) => {
    const set = new Set(allowed);
    return [...new Set(wanted)].filter((id) => set.has(id)).slice(0, UNDO_LIMIT);
  };
  return {
    bans: keep(
      candidates.bans.map((entry) => entry.userId),
      request.bans,
    ),
    timeouts: keep(
      candidates.timeouts.map((entry) => entry.userId),
      request.timeouts,
    ),
    channels: keep(
      candidates.channels.map((entry) => entry.id),
      request.channels,
    ),
    roles: keep(
      candidates.roles.map((entry) => entry.id),
      request.roles,
    ),
  };
}

const incidentColumns = (sql: Sql) => sql`
  i.id, i.guild_id as "guildId", i.kind, i.trigger, i.raid_id as "raidId",
  i.lockdown_id as "lockdownId", i.started_by as "startedBy", i.started_at as "startedAt",
  i.ends_at as "endsAt", i.ended_at as "endedAt", i.ended_by as "endedBy",
  i.undone_at as "undoneAt", i.undone_by as "undoneBy"
`;

const eventColumns = (sql: Sql) => sql`
  id::text as id, kind, user_id as "userId", actor_id as "actorId", by_maxwell as "byMaxwell",
  target_id as "targetId", count, detail, created_at as "createdAt"
`;

export class IncidentStore {
  readonly #tables = new Map<string, boolean>();

  constructor(private readonly sql: Sql) {}

  async #has(table: string): Promise<boolean> {
    const known = this.#tables.get(table);
    if (known !== undefined) return known;
    const [row] = await this.sql<{ ok: boolean }[]>`
      select to_regclass(${table}::text) is not null as ok
    `;
    const ok = row?.ok === true;
    if (ok) this.#tables.set(table, ok);
    return ok;
  }

  async open(input: OpenInput): Promise<{ incident: Incident; created: boolean }> {
    const [inserted] = await this.sql<Incident[]>`
      insert into security_incidents as i
        (guild_id, kind, trigger, raid_id, lockdown_id, started_by, started_at, ends_at)
      values (
        ${input.guildId}, ${input.kind}, ${input.trigger ?? null}, ${input.raidId ?? null},
        ${input.lockdownId ?? null}, ${input.startedBy}, ${input.startedAt ?? new Date()},
        ${input.endsAt}
      )
      on conflict (guild_id) where ended_at is null do nothing
      returning ${incidentColumns(this.sql)}
    `;
    if (inserted) return { incident: inserted, created: true };
    const [existing] = await this.sql<Incident[]>`
      update security_incidents as i set
        raid_id = coalesce(i.raid_id, ${input.raidId ?? null}),
        lockdown_id = coalesce(i.lockdown_id, ${input.lockdownId ?? null}),
        ends_at = case
          when i.ends_at is null or ${input.endsAt}::timestamptz is null then i.ends_at
          else greatest(i.ends_at, ${input.endsAt})
        end
      where i.guild_id = ${input.guildId} and i.ended_at is null
      returning ${incidentColumns(this.sql)}
    `;
    if (!existing) throw new Error('incident could not be opened');
    return { incident: existing, created: false };
  }

  async active(guildId: string): Promise<Incident | null> {
    const [row] = await this.sql<Incident[]>`
      select ${incidentColumns(this.sql)} from security_incidents i
      where i.guild_id = ${guildId} and i.ended_at is null
    `;
    return row ?? null;
  }

  async get(guildId: string, id: string): Promise<Incident | null> {
    const [row] = await this.sql<Incident[]>`
      select ${incidentColumns(this.sql)} from security_incidents i
      where i.guild_id = ${guildId} and i.id = ${id}
    `;
    return row ?? null;
  }

  async close(guildId: string, id: string, by: string | null): Promise<Incident | null> {
    const [row] = await this.sql<Incident[]>`
      update security_incidents as i set ended_at = now(), ended_by = ${by}
      where i.guild_id = ${guildId} and i.id = ${id} and i.ended_at is null
      returning ${incidentColumns(this.sql)}
    `;
    return row ?? null;
  }

  async markUndone(guildId: string, id: string, by: string | null): Promise<void> {
    await this.sql`
      update security_incidents set undone_at = now(), undone_by = ${by}
      where guild_id = ${guildId} and id = ${id}
    `;
  }

  async add(incident: Incident, input: IncidentEventInput): Promise<void> {
    await this.sql`
      insert into security_incident_events as e
        (incident_id, guild_id, kind, user_id, actor_id, by_maxwell, target_id, count, detail, created_at)
      values (
        ${incident.id}, ${incident.guildId}, ${input.kind}, ${input.userId ?? null},
        ${input.actorId ?? null}, ${input.byMaxwell ?? false}, ${input.targetId ?? null},
        ${input.count ?? 1}, ${this.sql.json((input.detail ?? {}) as never)},
        ${input.at ?? new Date()}
      )
      on conflict (incident_id, kind, target_id) where target_id is not null do update set
        actor_id = coalesce(excluded.actor_id, e.actor_id),
        by_maxwell = e.by_maxwell or excluded.by_maxwell,
        detail = e.detail || excluded.detail
    `;
  }

  async deleted(incident: Incident, count: number): Promise<void> {
    if (count <= 0) return;
    await this.sql.begin(async (tx) => {
      const merged = await tx`
        update security_incident_events set count = count + ${count}
        where id = (
          select id from security_incident_events
          where incident_id = ${incident.id} and kind = 'delete'
            and created_at > now() - make_interval(secs => ${DELETE_MERGE_SECONDS})
          order by id desc
          limit 1
        )
        returning id
      `;
      if (merged.length > 0) return;
      await tx`
        insert into security_incident_events (incident_id, guild_id, kind, count)
        values (${incident.id}, ${incident.guildId}, 'delete', ${count})
      `;
    });
  }

  async events(incident: Incident, limit = TIMELINE_LIMIT): Promise<IncidentEvent[]> {
    const until = incident.endedAt ?? new Date();
    const own = await this.sql<IncidentEvent[]>`
      select ${eventColumns(this.sql)} from security_incident_events
      where incident_id = ${incident.id}
      order by created_at, id
      limit ${limit}
    `;
    const extra: IncidentEvent[] = [];
    if (await this.#has('automod_hits')) {
      const hits = await this.sql<
        { id: string; userId: string; rule: string; action: string | null; createdAt: Date }[]
      >`
        select id::text as id, user_id as "userId", rule, action, created_at as "createdAt"
        from automod_hits
        where guild_id = ${incident.guildId}
          and created_at >= ${incident.startedAt} and created_at <= ${until}
        order by created_at
        limit ${limit}
      `;
      for (const hit of hits) {
        extra.push({
          id: `h${hit.id}`,
          kind: 'hit',
          userId: hit.userId,
          actorId: null,
          byMaxwell: true,
          targetId: null,
          count: 1,
          detail: { rule: hit.rule, action: hit.action },
          createdAt: hit.createdAt,
        });
      }
    }
    if (await this.#has('automod_incidents')) {
      const lockdowns = await this.sql<
        { id: string; startedAt: Date; endedAt: Date | null; startedBy: string | null }[]
      >`
        select id::text as id, started_at as "startedAt", ended_at as "endedAt",
          started_by as "startedBy"
        from automod_incidents
        where guild_id = ${incident.guildId}
          and started_at <= ${until}
          and (ended_at is null or ended_at >= ${incident.startedAt})
        order by started_at
        limit 50
      `;
      for (const lockdown of lockdowns) {
        if (lockdown.startedAt >= incident.startedAt) {
          extra.push({
            id: `l${lockdown.id}`,
            kind: 'lockdown',
            userId: null,
            actorId: lockdown.startedBy,
            byMaxwell: lockdown.startedBy === null,
            targetId: null,
            count: 1,
            detail: { on: true },
            createdAt: lockdown.startedAt,
          });
        }
        if (lockdown.endedAt && lockdown.endedAt <= until) {
          extra.push({
            id: `l${lockdown.id}e`,
            kind: 'lockdown',
            userId: null,
            actorId: null,
            byMaxwell: false,
            targetId: null,
            count: 1,
            detail: { on: false },
            createdAt: lockdown.endedAt,
          });
        }
      }
    }
    return [...own, ...extra]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
  }

  async list(guildId: string, limit = 20): Promise<IncidentSummary[]> {
    const hits = (await this.#has('automod_hits'))
      ? this.sql`(
          select count(*)::int from automod_hits h
          where h.guild_id = i.guild_id and h.created_at >= i.started_at
            and h.created_at <= coalesce(i.ended_at, now())
        )`
      : this.sql`0`;
    const rows = await this.sql<(Incident & IncidentTally)[]>`
      select ${incidentColumns(this.sql)},
        coalesce(t.joins, 0) as joins, coalesce(t.bans, 0) as bans,
        coalesce(t.kicks, 0) as kicks, coalesce(t.timeouts, 0) as timeouts,
        coalesce(t.deleted, 0) as deleted, coalesce(t.channels, 0) as channels,
        coalesce(t.roles, 0) as roles, ${hits} as hits
      from security_incidents i
      left join lateral (
        select
          count(*) filter (where kind = 'join')::int as joins,
          count(*) filter (where kind = 'ban')::int as bans,
          count(*) filter (where kind = 'kick')::int as kicks,
          count(*) filter (where kind = 'timeout')::int as timeouts,
          coalesce(sum(count) filter (where kind = 'delete'), 0)::int as deleted,
          count(*) filter (where kind in ('channelDelete', 'channelCreate'))::int as channels,
          count(*) filter (where kind in ('roleDelete', 'roleCreate'))::int as roles
        from security_incident_events e
        where e.incident_id = i.id
      ) t on true
      where i.guild_id = ${guildId}
      order by i.started_at desc
      limit ${Math.min(Math.max(limit, 1), 100)}
    `;
    return rows.map(
      ({ joins, bans, kicks, timeouts, deleted, hits, channels, roles, ...rest }) => ({
        ...rest,
        tally: { joins, bans, kicks, timeouts, deleted, hits, channels, roles },
      }),
    );
  }

  async memberData(guildId: string, userId: string): Promise<Record<string, unknown>[]> {
    const rows = await this.sql<{ kind: string; createdAt: Date }[]>`
      select kind, created_at as "createdAt" from security_incident_events
      where guild_id = ${guildId} and (user_id = ${userId} or actor_id = ${userId})
      order by created_at desc
    `;
    return [...rows];
  }

  async forgetMember(guildId: string, userId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`
        update security_incident_events
        set user_id = null, detail = detail - 'name',
          target_id = case when kind in ('join', 'ban', 'kick', 'timeout') then null else target_id end
        where guild_id = ${guildId} and user_id = ${userId}
      `;
      await tx`
        update security_incident_events set actor_id = null
        where guild_id = ${guildId} and actor_id = ${userId}
      `;
    });
  }
}
