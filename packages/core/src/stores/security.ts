import type { Sql } from '../db/sql.js';

export type CheckStatus =
  | 'pending'
  | 'passed'
  | 'clear'
  | 'failed'
  | 'expired'
  | 'left'
  | 'released';
export type CheckMethod = 'dm' | 'channel' | 'none';

export interface SecurityCheck {
  id: string;
  guildId: string;
  userId: string;
  score: number;
  reasons: unknown[];
  status: CheckStatus;
  method: CheckMethod | null;
  code: string | null;
  attempts: number;
  logChannelId: string | null;
  logMessageId: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  resolvedAt: Date | null;
}

export type SecurityEventKind = 'join' | 'raid' | 'nuke' | 'honeypot' | 'severe' | 'verify';

export interface SecurityEvent {
  id: string;
  guildId: string;
  kind: SecurityEventKind;
  userId: string | null;
  actorId: string | null;
  summary: string;
  detail: Record<string, unknown>;
  createdAt: Date;
}

export interface RaidState {
  pausedInvites?: boolean;
  slowmode?: { channelId: string; before: number }[];
}

export interface SecurityRaid {
  id: string;
  guildId: string;
  reason: string;
  startedBy: string | null;
  startedAt: Date;
  endsAt: Date | null;
  endedAt: Date | null;
  endedBy: string | null;
  state: RaidState;
}

export interface CheckInput {
  guildId: string;
  userId: string;
  score: number;
  reasons: readonly unknown[];
  status: CheckStatus;
  method: CheckMethod | null;
  code: string | null;
  expiresAt: Date | null;
}

const checkColumns = (sql: Sql) => sql`
  id, guild_id as "guildId", user_id as "userId", score, reasons, status, method, code, attempts,
  log_channel_id as "logChannelId", log_message_id as "logMessageId",
  created_at as "createdAt", expires_at as "expiresAt", resolved_at as "resolvedAt"
`;

const raidColumns = (sql: Sql) => sql`
  id, guild_id as "guildId", reason, started_by as "startedBy", started_at as "startedAt",
  ends_at as "endsAt", ended_at as "endedAt", ended_by as "endedBy", state
`;

export class SecurityStore {
  constructor(private readonly sql: Sql) {}

  async openCheck(input: CheckInput): Promise<SecurityCheck> {
    const sql = this.sql;
    return sql.begin(async (tx) => {
      if (input.status === 'pending') {
        await tx`
          update security_checks set status = 'released', resolved_at = now()
          where guild_id = ${input.guildId} and user_id = ${input.userId} and status = 'pending'
        `;
      }
      const [row] = await tx<SecurityCheck[]>`
        insert into security_checks (guild_id, user_id, score, reasons, status, method, code, expires_at, resolved_at)
        values (
          ${input.guildId}, ${input.userId}, ${input.score}, ${tx.json([...input.reasons] as never)},
          ${input.status}, ${input.method}, ${input.code}, ${input.expiresAt},
          ${input.status === 'pending' ? null : new Date()}
        )
        returning ${checkColumns(tx as unknown as Sql)}
      `;
      if (!row) throw new Error('security check insert returned nothing');
      return row;
    }) as Promise<SecurityCheck>;
  }

  async pending(guildId: string, userId: string): Promise<SecurityCheck | null> {
    const [row] = await this.sql<SecurityCheck[]>`
      select ${checkColumns(this.sql)} from security_checks
      where guild_id = ${guildId} and user_id = ${userId} and status = 'pending'
    `;
    return row ?? null;
  }

  async pendingFor(userId: string): Promise<SecurityCheck[]> {
    return this.sql<SecurityCheck[]>`
      select ${checkColumns(this.sql)} from security_checks
      where user_id = ${userId} and status = 'pending'
      order by created_at desc
    `;
  }

  async pendingAll(guildIds: readonly string[]): Promise<SecurityCheck[]> {
    if (guildIds.length === 0) return [];
    return this.sql<SecurityCheck[]>`
      select ${checkColumns(this.sql)} from security_checks
      where status = 'pending' and guild_id = any(${this.sql.array([...guildIds])}::bigint[])
    `;
  }

  async check(guildId: string, id: string): Promise<SecurityCheck | null> {
    const [row] = await this.sql<SecurityCheck[]>`
      select ${checkColumns(this.sql)} from security_checks
      where guild_id = ${guildId} and id = ${id}
    `;
    return row ?? null;
  }

  async lastScore(guildId: string, userId: string, since: Date): Promise<number | null> {
    const [row] = await this.sql<{ score: number }[]>`
      select score from security_checks
      where guild_id = ${guildId} and user_id = ${userId} and created_at >= ${since}
      order by id desc
      limit 1
    `;
    return row?.score ?? null;
  }

  async recentChecks(guildId: string, limit = 50): Promise<SecurityCheck[]> {
    return this.sql<SecurityCheck[]>`
      select ${checkColumns(this.sql)} from security_checks
      where guild_id = ${guildId}
      order by created_at desc
      limit ${Math.min(Math.max(limit, 1), 200)}
    `;
  }

  async attempt(id: string): Promise<number> {
    const [row] = await this.sql<{ attempts: number }[]>`
      update security_checks set attempts = attempts + 1
      where id = ${id} and status = 'pending'
      returning attempts
    `;
    return row?.attempts ?? 0;
  }

  async setCode(id: string, code: string, method: CheckMethod): Promise<void> {
    await this.sql`
      update security_checks set code = ${code}, method = ${method}
      where id = ${id} and status = 'pending'
    `;
  }

  async setLog(id: string, channelId: string, messageId: string): Promise<void> {
    await this.sql`
      update security_checks set log_channel_id = ${channelId}, log_message_id = ${messageId}
      where id = ${id}
    `;
  }

  async resolve(
    id: string,
    status: Exclude<CheckStatus, 'pending'>,
  ): Promise<SecurityCheck | null> {
    const [row] = await this.sql<SecurityCheck[]>`
      update security_checks set status = ${status}, resolved_at = now()
      where id = ${id} and status = 'pending'
      returning ${checkColumns(this.sql)}
    `;
    return row ?? null;
  }

  async resolveMember(
    guildId: string,
    userId: string,
    status: Exclude<CheckStatus, 'pending'>,
  ): Promise<SecurityCheck | null> {
    const [row] = await this.sql<SecurityCheck[]>`
      update security_checks set status = ${status}, resolved_at = now()
      where guild_id = ${guildId} and user_id = ${userId} and status = 'pending'
      returning ${checkColumns(this.sql)}
    `;
    return row ?? null;
  }

  async counts(
    guildId: string,
    since: Date,
  ): Promise<{
    checked: number;
    flagged: number;
    passed: number;
    failed: number;
    pending: number;
  }> {
    const [row] = await this.sql<
      { checked: number; flagged: number; passed: number; failed: number; pending: number }[]
    >`
      select
        count(*)::int as checked,
        count(*) filter (where status <> 'clear')::int as flagged,
        count(*) filter (where status = 'passed')::int as passed,
        count(*) filter (where status in ('failed', 'expired'))::int as failed,
        count(*) filter (where status = 'pending')::int as pending
      from security_checks
      where guild_id = ${guildId} and created_at >= ${since}
    `;
    return row ?? { checked: 0, flagged: 0, passed: 0, failed: 0, pending: 0 };
  }

  async history(
    guildId: string,
    userId: string,
  ): Promise<{ kicks: number; bans: number; leftAt: Date | null }> {
    const [cases] = await this.sql<{ kicks: number; bans: number }[]>`
      select
        count(*) filter (where action = 'kick')::int as kicks,
        count(*) filter (where action = 'ban')::int as bans
      from moderation_cases
      where guild_id = ${guildId} and user_id = ${userId} and voided_at is null
    `;
    const [left] = await this.sql<{ leftAt: Date | null }[]>`
      select max(left_at) as "leftAt" from member_joins
      where guild_id = ${guildId} and user_id = ${userId} and left_at is not null
    `;
    return { kicks: cases?.kicks ?? 0, bans: cases?.bans ?? 0, leftAt: left?.leftAt ?? null };
  }

  async joinedAt(guildId: string, userId: string): Promise<Date | null> {
    const [row] = await this.sql<{ joinedAt: Date | null }[]>`
      select max(joined_at) as "joinedAt" from member_joins
      where guild_id = ${guildId} and user_id = ${userId} and left_at is null
    `;
    return row?.joinedAt ?? null;
  }

  async event(input: Omit<SecurityEvent, 'id' | 'createdAt'>): Promise<SecurityEvent> {
    const [row] = await this.sql<SecurityEvent[]>`
      insert into security_events (guild_id, kind, user_id, actor_id, summary, detail)
      values (
        ${input.guildId}, ${input.kind}, ${input.userId}, ${input.actorId},
        ${input.summary.slice(0, 500)}, ${this.sql.json(input.detail as never)}
      )
      returning id, guild_id as "guildId", kind, user_id as "userId", actor_id as "actorId",
        summary, detail, created_at as "createdAt"
    `;
    if (!row) throw new Error('security event insert returned nothing');
    return row;
  }

  async events(guildId: string, limit = 50, kind?: SecurityEventKind): Promise<SecurityEvent[]> {
    return this.sql<SecurityEvent[]>`
      select id, guild_id as "guildId", kind, user_id as "userId", actor_id as "actorId",
        summary, detail, created_at as "createdAt"
      from security_events
      where guild_id = ${guildId}
        ${kind ? this.sql`and kind = ${kind}` : this.sql``}
      order by id desc
      limit ${Math.min(Math.max(limit, 1), 200)}
    `;
  }

  async activeRaid(guildId: string): Promise<SecurityRaid | null> {
    const [row] = await this.sql<SecurityRaid[]>`
      select ${raidColumns(this.sql)} from security_raids
      where guild_id = ${guildId} and ended_at is null
    `;
    return row ?? null;
  }

  async raids(guildId: string, limit = 10): Promise<SecurityRaid[]> {
    return this.sql<SecurityRaid[]>`
      select ${raidColumns(this.sql)} from security_raids
      where guild_id = ${guildId}
      order by started_at desc
      limit ${Math.min(Math.max(limit, 1), 50)}
    `;
  }

  async startRaid(
    guildId: string,
    reason: string,
    startedBy: string | null,
    endsAt: Date,
  ): Promise<{ raid: SecurityRaid; created: boolean }> {
    const [inserted] = await this.sql<SecurityRaid[]>`
      insert into security_raids (guild_id, reason, started_by, ends_at)
      values (${guildId}, ${reason}, ${startedBy}, ${endsAt})
      on conflict (guild_id) where ended_at is null do nothing
      returning ${raidColumns(this.sql)}
    `;
    if (inserted) return { raid: inserted, created: true };
    const [extended] = await this.sql<SecurityRaid[]>`
      update security_raids set ends_at = greatest(ends_at, ${endsAt})
      where guild_id = ${guildId} and ended_at is null
      returning ${raidColumns(this.sql)}
    `;
    if (!extended) throw new Error('raid could not be started or extended');
    return { raid: extended, created: false };
  }

  async setRaidState(id: string, state: RaidState): Promise<void> {
    await this.sql`
      update security_raids set state = ${this.sql.json(state as never)} where id = ${id}
    `;
  }

  async endRaid(guildId: string, by: string | null): Promise<SecurityRaid | null> {
    const [row] = await this.sql<SecurityRaid[]>`
      update security_raids set ended_at = now(), ended_by = ${by}
      where guild_id = ${guildId} and ended_at is null
      returning ${raidColumns(this.sql)}
    `;
    return row ?? null;
  }

  async memberData(guildId: string, userId: string): Promise<Record<string, unknown> | null> {
    const checks = await this.sql<
      Pick<SecurityCheck, 'score' | 'reasons' | 'status' | 'createdAt'>[]
    >`
      select score, reasons, status, created_at as "createdAt" from security_checks
      where guild_id = ${guildId} and user_id = ${userId}
      order by created_at desc
    `;
    const events = await this.sql<Pick<SecurityEvent, 'kind' | 'summary' | 'createdAt'>[]>`
      select kind, summary, created_at as "createdAt" from security_events
      where guild_id = ${guildId} and (user_id = ${userId} or actor_id = ${userId})
      order by created_at desc
    `;
    if (checks.length + events.length === 0) return null;
    return { checks: [...checks], events: [...events] };
  }

  async forgetMember(guildId: string, userId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`
        delete from security_checks
        where guild_id = ${guildId} and user_id = ${userId} and status <> 'pending'
      `;
      await tx`
        update security_events set user_id = null
        where guild_id = ${guildId} and user_id = ${userId}
      `;
      await tx`
        update security_events set actor_id = null
        where guild_id = ${guildId} and actor_id = ${userId}
      `;
    });
  }

  async purge(before: Date): Promise<number> {
    const checks = await this.sql`
      delete from security_checks where status <> 'pending' and created_at < ${before} returning 1
    `;
    const events = await this.sql`
      delete from security_events where created_at < ${before} returning 1
    `;
    return checks.length + events.length;
  }
}
