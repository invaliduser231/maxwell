import type { Sql } from '../db/sql.js';

export interface AutomodHit {
  id: string;
  guildId: string;
  userId: string;
  channelId: string | null;
  messageId: string | null;
  rule: string;
  mode: string;
  action: string | null;
  detail: string;
  content: string | null;
  createdAt: Date;
}

export type HitInput = Omit<AutomodHit, 'id' | 'createdAt'> & { createdAt?: Date };

export interface StoredMessage {
  guildId: string;
  messageId: string;
  channelId: string;
  authorId: string;
  authorRoles: string[];
  authorBot: boolean;
  content: string;
  mentionUsers: number;
  mentionRoles: number;
  createdAt: Date;
}

export type DryRunStatus = 'pending' | 'running' | 'done' | 'failed';

export interface DryRunSample {
  messageId: string;
  channelId: string;
  authorId: string;
  content: string;
  detail: string;
  byMod: boolean;
  createdAt: string;
}

export interface DryRun {
  id: string;
  guildId: string;
  ruleKey: string;
  rule: Record<string, unknown>;
  status: DryRunStatus;
  requestedBy: string | null;
  scanned: number;
  caught: number;
  byMods: number;
  samples: DryRunSample[];
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface DryRunResult {
  scanned: number;
  caught: number;
  byMods: number;
  samples: DryRunSample[];
}

export type IncidentReason = 'raid' | 'manual';

export interface Incident {
  id: string;
  guildId: string;
  reason: IncidentReason;
  startedBy: string | null;
  startedAt: Date;
  endsAt: Date | null;
  endedAt: Date | null;
  endedBy: string | null;
  held: number;
}

export type HoldReason = 'raid' | 'lockdown' | 'account_age' | 'verify' | 'honeypot';
export type HoldOutcome = 'let_in' | 'banned' | 'left';

export interface HeldMember {
  id: string;
  guildId: string;
  userId: string;
  incidentId: string | null;
  reason: HoldReason;
  heldAt: Date;
  resolvedAt: Date | null;
  outcome: HoldOutcome | null;
  resolvedBy: string | null;
}

const MESSAGE_LIMIT = 4000;
const SAMPLE_LIMIT = 20;

export class AutomodStore {
  constructor(private readonly sql: Sql) {}

  async recordHits(hits: readonly HitInput[]): Promise<void> {
    if (hits.length === 0) return;
    const rows = hits.map((hit) => ({
      guild_id: hit.guildId,
      user_id: hit.userId,
      channel_id: hit.channelId,
      message_id: hit.messageId,
      rule: hit.rule,
      mode: hit.mode,
      action: hit.action,
      detail: hit.detail.slice(0, 500),
      content: hit.content === null ? null : hit.content.slice(0, MESSAGE_LIMIT),
      created_at: (hit.createdAt ?? new Date()).toISOString(),
    }));
    await this.sql`
      insert into automod_hits (guild_id, user_id, channel_id, message_id, rule, mode, action, detail, content, created_at)
      select guild_id, user_id, channel_id, message_id, rule, mode, action, detail, content, created_at
      from jsonb_to_recordset(${this.sql.json(rows as never)}) as x(
        guild_id bigint, user_id bigint, channel_id bigint, message_id bigint, rule text, mode text,
        action text, detail text, content text, created_at timestamptz
      )
    `;
  }

  async hitsForMember(guildId: string, userId: string, limit = 50): Promise<AutomodHit[]> {
    return this.sql<AutomodHit[]>`
      select id, guild_id as "guildId", user_id as "userId", channel_id as "channelId",
        message_id as "messageId", rule, mode, action, detail, content, created_at as "createdAt"
      from automod_hits
      where guild_id = ${guildId} and user_id = ${userId}
      order by created_at desc
      limit ${clamp(limit, 1, 200)}
    `;
  }

  async recentHits(
    guildId: string,
    options: { rule?: string; before?: string; limit?: number } = {},
  ): Promise<AutomodHit[]> {
    return this.sql<AutomodHit[]>`
      select id, guild_id as "guildId", user_id as "userId", channel_id as "channelId",
        message_id as "messageId", rule, mode, action, detail, content, created_at as "createdAt"
      from automod_hits
      where guild_id = ${guildId}
        ${options.rule ? this.sql`and rule = ${options.rule}` : this.sql``}
        ${options.before ? this.sql`and id < ${options.before}` : this.sql``}
      order by id desc
      limit ${clamp(options.limit ?? 50, 1, 200)}
    `;
  }

  async hitCounts(guildId: string, since: Date): Promise<{ rule: string; hits: number }[]> {
    return this.sql<{ rule: string; hits: number }[]>`
      select rule, count(*)::int as hits
      from automod_hits
      where guild_id = ${guildId} and created_at >= ${since}
      group by rule
      order by hits desc
    `;
  }

  async purgeHits(olderThan: Date): Promise<number> {
    const rows = await this
      .sql`delete from automod_hits where created_at < ${olderThan} returning 1`;
    return rows.length;
  }

  async saveMessages(messages: readonly StoredMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const rows = messages.map((message) => ({
      guild_id: message.guildId,
      message_id: message.messageId,
      channel_id: message.channelId,
      author_id: message.authorId,
      author_roles: message.authorRoles,
      author_bot: message.authorBot,
      content: message.content.slice(0, MESSAGE_LIMIT),
      mention_users: message.mentionUsers,
      mention_roles: message.mentionRoles,
      created_at: message.createdAt.toISOString(),
    }));
    await this.sql`
      insert into automod_messages (
        guild_id, message_id, channel_id, author_id, author_roles, author_bot, content,
        mention_users, mention_roles, created_at
      )
      select guild_id, message_id, channel_id, author_id, author_roles, author_bot, content,
        mention_users, mention_roles, created_at
      from jsonb_to_recordset(${this.sql.json(rows as never)}) as x(
        guild_id bigint, message_id bigint, channel_id bigint, author_id bigint, author_roles jsonb,
        author_bot boolean, content text, mention_users integer, mention_roles integer,
        created_at timestamptz
      )
      on conflict (guild_id, message_id) do nothing
    `;
  }

  async editMessage(guildId: string, messageId: string, content: string): Promise<void> {
    await this.sql`
      update automod_messages set content = ${content.slice(0, MESSAGE_LIMIT)}
      where guild_id = ${guildId} and message_id = ${messageId}
    `;
  }

  async replay(
    guildId: string,
    since: Date,
    after: { createdAt: Date; messageId: string } | null,
    limit = 2000,
  ): Promise<StoredMessage[]> {
    return this.sql<StoredMessage[]>`
      select guild_id as "guildId", message_id as "messageId", channel_id as "channelId",
        author_id as "authorId", author_roles as "authorRoles", author_bot as "authorBot", content,
        mention_users as "mentionUsers", mention_roles as "mentionRoles", created_at as "createdAt"
      from automod_messages
      where guild_id = ${guildId} and created_at >= ${since}
        ${
          after
            ? this.sql`and (created_at, message_id) > (${after.createdAt}, ${after.messageId})`
            : this.sql``
        }
      order by created_at, message_id
      limit ${clamp(limit, 1, 10_000)}
    `;
  }

  async messageCount(guildId: string): Promise<number> {
    const [row] = await this.sql<{ total: number }[]>`
      select count(*)::int as total from automod_messages where guild_id = ${guildId}
    `;
    return row?.total ?? 0;
  }

  async messageGuilds(): Promise<string[]> {
    const rows = await this.sql<{ guildId: string }[]>`
      select distinct guild_id as "guildId" from automod_messages
    `;
    return rows.map((row) => row.guildId);
  }

  async purgeMessages(olderThan: Date, maxPerGuild: number): Promise<number> {
    const old = await this.sql`
      delete from automod_messages where created_at < ${olderThan} returning 1
    `;
    const crowded = await this.sql<{ guildId: string }[]>`
      select guild_id as "guildId" from automod_messages
      group by guild_id having count(*) > ${maxPerGuild}
    `;
    let extra = 0;
    for (const { guildId } of crowded) {
      const rows = await this.sql`
        delete from automod_messages
        where guild_id = ${guildId} and (created_at, message_id) < (
          select created_at, message_id from automod_messages
          where guild_id = ${guildId}
          order by created_at desc, message_id desc
          offset ${maxPerGuild - 1} limit 1
        )
        returning 1
      `;
      extra += rows.length;
    }
    return old.length + extra;
  }

  async dropMessages(guildId: string): Promise<number> {
    const rows = await this.sql`
      delete from automod_messages where guild_id = ${guildId} returning 1
    `;
    return rows.length;
  }

  async createDryRun(
    guildId: string,
    ruleKey: string,
    rule: Record<string, unknown>,
    requestedBy: string | null,
  ): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into automod_dryruns (guild_id, rule_key, rule, requested_by)
      values (${guildId}, ${ruleKey}, ${this.sql.json(rule as never)}, ${requestedBy})
      returning id
    `;
    return row?.id ?? '';
  }

  async getDryRun(guildId: string, id: string): Promise<DryRun | null> {
    const [row] = await this.sql<DryRun[]>`
      select id, guild_id as "guildId", rule_key as "ruleKey", rule, status,
        requested_by as "requestedBy", scanned, caught, by_mods as "byMods", samples, error,
        created_at as "createdAt", finished_at as "finishedAt"
      from automod_dryruns where guild_id = ${guildId} and id = ${id}
    `;
    return row ?? null;
  }

  async listDryRuns(guildId: string, limit = 10): Promise<DryRun[]> {
    return this.sql<DryRun[]>`
      select id, guild_id as "guildId", rule_key as "ruleKey", rule, status,
        requested_by as "requestedBy", scanned, caught, by_mods as "byMods", samples, error,
        created_at as "createdAt", finished_at as "finishedAt"
      from automod_dryruns where guild_id = ${guildId}
      order by id desc
      limit ${clamp(limit, 1, 50)}
    `;
  }

  async startDryRun(guildId: string, id: string): Promise<void> {
    await this.sql`
      update automod_dryruns set status = 'running', error = null
      where guild_id = ${guildId} and id = ${id}
    `;
  }

  async finishDryRun(guildId: string, id: string, result: DryRunResult): Promise<void> {
    await this.sql`
      update automod_dryruns set
        status = 'done',
        scanned = ${result.scanned},
        caught = ${result.caught},
        by_mods = ${result.byMods},
        samples = ${this.sql.json(result.samples.slice(0, SAMPLE_LIMIT) as never)},
        finished_at = now()
      where guild_id = ${guildId} and id = ${id}
    `;
  }

  async failDryRun(guildId: string, id: string, error: string): Promise<void> {
    await this.sql`
      update automod_dryruns set status = 'failed', error = ${error.slice(0, 500)}, finished_at = now()
      where guild_id = ${guildId} and id = ${id}
    `;
  }

  async purgeDryRuns(olderThan: Date): Promise<number> {
    const rows = await this.sql`
      delete from automod_dryruns where created_at < ${olderThan} returning 1
    `;
    return rows.length;
  }

  async startIncident(
    guildId: string,
    reason: IncidentReason,
    startedBy: string | null,
    endsAt: Date | null,
  ): Promise<Incident> {
    const [row] = await this.sql<Incident[]>`
      insert into automod_incidents (guild_id, reason, started_by, ends_at)
      values (${guildId}, ${reason}, ${startedBy}, ${endsAt})
      returning id, guild_id as "guildId", reason, started_by as "startedBy", started_at as "startedAt",
        ends_at as "endsAt", ended_at as "endedAt", ended_by as "endedBy", 0 as held
    `;
    if (!row) throw new Error('incident insert returned nothing');
    return row;
  }

  async activeIncident(guildId: string): Promise<Incident | null> {
    const [row] = await this.sql<Incident[]>`
      select i.id, i.guild_id as "guildId", i.reason, i.started_by as "startedBy",
        i.started_at as "startedAt", i.ends_at as "endsAt", i.ended_at as "endedAt",
        i.ended_by as "endedBy",
        (select count(*)::int from automod_held h where h.incident_id = i.id and h.resolved_at is null) as held
      from automod_incidents i
      where i.guild_id = ${guildId} and i.ended_at is null
      order by i.started_at desc
      limit 1
    `;
    return row ?? null;
  }

  async incident(guildId: string, id: string): Promise<Incident | null> {
    const [row] = await this.sql<Incident[]>`
      select i.id, i.guild_id as "guildId", i.reason, i.started_by as "startedBy",
        i.started_at as "startedAt", i.ends_at as "endsAt", i.ended_at as "endedAt",
        i.ended_by as "endedBy",
        (select count(*)::int from automod_held h where h.incident_id = i.id and h.resolved_at is null) as held
      from automod_incidents i
      where i.guild_id = ${guildId} and i.id = ${id}
    `;
    return row ?? null;
  }

  async incidents(guildId: string, limit = 20): Promise<Incident[]> {
    return this.sql<Incident[]>`
      select i.id, i.guild_id as "guildId", i.reason, i.started_by as "startedBy",
        i.started_at as "startedAt", i.ends_at as "endsAt", i.ended_at as "endedAt",
        i.ended_by as "endedBy",
        (select count(*)::int from automod_held h where h.incident_id = i.id) as held
      from automod_incidents i
      where i.guild_id = ${guildId}
      order by i.started_at desc
      limit ${clamp(limit, 1, 100)}
    `;
  }

  async extendIncident(guildId: string, id: string, endsAt: Date | null): Promise<void> {
    await this.sql`
      update automod_incidents set ends_at = ${endsAt}
      where guild_id = ${guildId} and id = ${id} and ended_at is null
    `;
  }

  async endIncident(guildId: string, id: string, by: string | null): Promise<boolean> {
    const rows = await this.sql`
      update automod_incidents set ended_at = now(), ended_by = ${by}
      where guild_id = ${guildId} and id = ${id} and ended_at is null
      returning id
    `;
    return rows.length > 0;
  }

  async hold(
    guildId: string,
    userId: string,
    incidentId: string | null,
    reason: HoldReason,
  ): Promise<boolean> {
    const rows = await this.sql`
      insert into automod_held (guild_id, user_id, incident_id, reason)
      values (${guildId}, ${userId}, ${incidentId}, ${reason})
      on conflict (guild_id, user_id) where resolved_at is null do nothing
      returning id
    `;
    return rows.length > 0;
  }

  async held(guildId: string, incidentId?: string | null): Promise<HeldMember[]> {
    return this.sql<HeldMember[]>`
      select id, guild_id as "guildId", user_id as "userId", incident_id as "incidentId", reason,
        held_at as "heldAt", resolved_at as "resolvedAt", outcome, resolved_by as "resolvedBy"
      from automod_held
      where guild_id = ${guildId} and resolved_at is null
        ${incidentId ? this.sql`and incident_id = ${incidentId}` : this.sql``}
      order by held_at
      limit 5000
    `;
  }

  async isHeld(guildId: string, userId: string): Promise<boolean> {
    const [row] = await this.sql`
      select 1 from automod_held
      where guild_id = ${guildId} and user_id = ${userId} and resolved_at is null
    `;
    return row !== undefined;
  }

  async resolveHeld(
    guildId: string,
    userIds: readonly string[],
    outcome: HoldOutcome,
    by: string | null,
  ): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.sql<{ userId: string }[]>`
      update automod_held set resolved_at = now(), outcome = ${outcome}, resolved_by = ${by}
      where guild_id = ${guildId} and resolved_at is null
        and user_id in ${this.sql(userIds as string[])}
      returning user_id as "userId"
    `;
    return rows.map((row) => row.userId);
  }

  async memberData(guildId: string, userId: string): Promise<Record<string, unknown> | null> {
    const hits = await this.sql<Omit<AutomodHit, 'guildId' | 'userId'>[]>`
      select id, channel_id as "channelId", message_id as "messageId", rule, mode, action, detail,
        content, created_at as "createdAt"
      from automod_hits
      where guild_id = ${guildId} and user_id = ${userId}
      order by created_at desc
    `;
    const messages = await this.sql<
      { messageId: string; channelId: string; content: string; createdAt: Date }[]
    >`
      select message_id as "messageId", channel_id as "channelId", content, created_at as "createdAt"
      from automod_messages
      where guild_id = ${guildId} and author_id = ${userId}
      order by created_at desc
    `;
    const held = await this.sql<Pick<HeldMember, 'reason' | 'heldAt' | 'resolvedAt' | 'outcome'>[]>`
      select reason, held_at as "heldAt", resolved_at as "resolvedAt", outcome
      from automod_held
      where guild_id = ${guildId} and user_id = ${userId}
      order by held_at desc
    `;
    const samples = await this.sql<{ dryRunId: string; sample: DryRunSample }[]>`
      select d.id as "dryRunId", s.value as sample
      from automod_dryruns d
      cross join lateral jsonb_array_elements(d.samples) s
      where d.guild_id = ${guildId} and s.value ->> 'authorId' = ${userId}
      order by d.id desc
    `;
    if (hits.length + messages.length + held.length + samples.length === 0) return null;
    return {
      hits: [...hits],
      storedMessages: [...messages],
      gateHolds: [...held],
      dryRunSamples: samples.map((row) => ({ dryRunId: row.dryRunId, ...row.sample })),
    };
  }

  async forgetMember(guildId: string, userId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`delete from automod_hits where guild_id = ${guildId} and user_id = ${userId}`;
      await tx`delete from automod_messages where guild_id = ${guildId} and author_id = ${userId}`;
      await tx`
        delete from automod_held
        where guild_id = ${guildId} and user_id = ${userId} and resolved_at is not null
      `;
      await tx`
        update automod_dryruns set samples = coalesce((
          select jsonb_agg(s.value order by s.ordinality)
          from jsonb_array_elements(samples) with ordinality s
          where s.value ->> 'authorId' is distinct from ${userId}
        ), '[]'::jsonb)
        where guild_id = ${guildId} and exists (
          select 1 from jsonb_array_elements(samples) s where s.value ->> 'authorId' = ${userId}
        )
      `;
      await tx`
        update automod_dryruns set requested_by = null
        where guild_id = ${guildId} and requested_by = ${userId}
      `;
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}
