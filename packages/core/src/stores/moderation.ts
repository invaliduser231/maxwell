import type { Sql } from '../db/sql.js';
import type { CaseAction } from '../modules/moderation.js';

export interface CaseRow {
  guildId: string;
  number: number;
  action: CaseAction;
  userId: string | null;
  moderatorId: string | null;
  reason: string | null;
  durationSeconds: number | null;
  expiresAt: Date | null;
  endedAt: Date | null;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
  evidence: string[];
  excerpt: string | null;
  meta: Record<string, unknown>;
  logChannelId: string | null;
  logMessageId: string | null;
  editedBy: string | null;
  editedAt: Date | null;
  createdAt: Date;
}

export interface CaseInput {
  guildId: string;
  action: CaseAction;
  userId: string | null;
  moderatorId: string | null;
  reason?: string | null;
  durationSeconds?: number | null;
  expiresAt?: Date | null;
  excerpt?: string | null;
  meta?: Record<string, unknown>;
}

export interface CaseFilter {
  action?: CaseAction;
  moderatorId?: string;
  userId?: string;
  since?: Date;
  until?: Date;
  search?: string;
  before?: number;
  includeVoided?: boolean;
  limit?: number;
  offset?: number;
}

export interface ModerationOverview {
  activeTimeouts: number;
  timeoutEndsAt: Date | null;
  activeBans: number;
  temporaryBans: number;
  warns30: number;
  warned30: number;
  total30: number;
  automated30: number;
}

export type MemberView = 'flagged' | 'new' | 'all';

export interface MemberListRow {
  userId: string;
  username: string | null;
  display: string | null;
  lastAt: Date;
  joinedAt: Date | null;
  leftAt: Date | null;
  activeWarns: number;
  banned: boolean;
  timedOut: boolean;
  review: boolean;
  nameChanges: number;
  newAccount: boolean;
}

export interface JoinRow {
  joinedAt: Date;
  leftAt: Date | null;
  inviteCode: string | null;
  inviterId: string | null;
  joinSource: number | null;
}

export interface NoteRow {
  id: string;
  number: number;
  guildId: string;
  userId: string;
  authorId: string | null;
  body: string;
  createdAt: Date;
}

export type NameKind = 'nick' | 'username' | 'display';

export interface NameRow {
  id: string;
  kind: NameKind;
  value: string | null;
  previous: string | null;
  baseline: boolean;
  changedAt: Date;
}

export interface StoredOverwrite {
  id: string;
  type: 'role' | 'member';
  allow: string[];
  deny: string[];
}

export interface OverwriteChange {
  id: string;
  type: 'role' | 'member';
  before: StoredOverwrite | null;
  after: StoredOverwrite;
}

export interface LockRow {
  guildId: string;
  channelId: string;
  changes: OverwriteChange[];
  moderatorId: string | null;
  reason: string | null;
  endsAt: Date | null;
  createdAt: Date;
}

export interface MemberSummary {
  total: number;
  actions: Partial<Record<CaseAction, number>>;
  activeWarns: number;
  notes: number;
  nameChanges: number;
}

export interface MemberExport {
  cases: CaseRow[];
  names: NameRow[];
  notes: number;
  issued: number;
}

const caseColumns = (sql: Sql) => sql`
  guild_id::text as "guildId", number, action, user_id::text as "userId",
  moderator_id::text as "moderatorId", reason, duration_seconds as "durationSeconds",
  expires_at as "expiresAt", ended_at as "endedAt", voided_at as "voidedAt",
  voided_by::text as "voidedBy", void_reason as "voidReason", evidence, excerpt, meta,
  log_channel_id::text as "logChannelId", log_message_id::text as "logMessageId",
  edited_by::text as "editedBy", edited_at as "editedAt", created_at as "createdAt"
`;

function expiryCutoff(expiryDays: number | null, now = Date.now()): Date | null {
  return expiryDays === null ? null : new Date(now - expiryDays * 86_400_000);
}

export function warnExpiresAt(createdAt: Date, expiryDays: number | null): Date | null {
  return expiryDays === null ? null : new Date(createdAt.getTime() + expiryDays * 86_400_000);
}

export class ModerationStore {
  constructor(private readonly sql: Sql) {}

  async create(input: CaseInput): Promise<CaseRow> {
    return this.sql.begin(async (tx) => {
      const [counter] = await tx<{ number: number }[]>`
        insert into moderation_counters (guild_id, last_number) values (${input.guildId}, 1)
        on conflict (guild_id) do update set last_number = moderation_counters.last_number + 1
        returning last_number as number
      `;
      const number = counter?.number ?? 1;
      const [row] = await tx<CaseRow[]>`
        insert into moderation_cases (
          guild_id, number, action, user_id, moderator_id, reason, duration_seconds,
          expires_at, excerpt, meta
        ) values (
          ${input.guildId}, ${number}, ${input.action}, ${input.userId}, ${input.moderatorId},
          ${input.reason ?? null}, ${input.durationSeconds ?? null}, ${input.expiresAt ?? null},
          ${input.excerpt ?? null}, ${tx.json((input.meta ?? {}) as never)}
        )
        returning ${caseColumns(this.sql)}
      `;
      if (!row) throw new Error('case insert returned nothing');
      return row;
    });
  }

  async get(guildId: string, number: number): Promise<CaseRow | null> {
    const [row] = await this.sql<CaseRow[]>`
      select ${caseColumns(this.sql)} from moderation_cases
      where guild_id = ${guildId} and number = ${number}
    `;
    return row ?? null;
  }

  async list(guildId: string, filter: CaseFilter = {}): Promise<CaseRow[]> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    const sql = this.sql;
    const search = filter.search?.trim();
    const searchId = search && /^\d{1,20}$/.test(search) ? search : null;
    return sql<CaseRow[]>`
      select ${caseColumns(sql)} from moderation_cases
      where guild_id = ${guildId}
        ${filter.action ? sql`and action = ${filter.action}` : sql``}
        ${filter.moderatorId ? sql`and moderator_id = ${filter.moderatorId}` : sql``}
        ${filter.userId ? sql`and user_id = ${filter.userId}` : sql``}
        ${filter.since ? sql`and created_at >= ${filter.since}` : sql``}
        ${filter.until ? sql`and created_at < ${filter.until}` : sql``}
        ${filter.before ? sql`and number < ${filter.before}` : sql``}
        ${filter.includeVoided === false ? sql`and voided_at is null` : sql``}
        ${
          search
            ? searchId
              ? sql`and (user_id = ${searchId} or moderator_id = ${searchId} or number = ${Number(searchId) <= 2_147_483_647 ? Number(searchId) : 0})`
              : sql`and (reason ilike ${`%${search}%`} or excerpt ilike ${`%${search}%`})`
            : sql``
        }
      order by number desc
      limit ${limit}
      offset ${Math.max(filter.offset ?? 0, 0)}
    `;
  }

  async overview(guildId: string, now = Date.now()): Promise<ModerationOverview> {
    const since = new Date(now - 30 * 86_400_000);
    const [row] = await this.sql<ModerationOverview[]>`
      select
        count(*) filter (where action = 'timeout' and ended_at is null and voided_at is null
          and expires_at > now())::int as "activeTimeouts",
        max(expires_at) filter (where action = 'timeout' and ended_at is null and voided_at is null
          and expires_at > now()) as "timeoutEndsAt",
        count(*) filter (where action = 'ban' and ended_at is null and voided_at is null
          and (expires_at is null or expires_at > now()))::int as "activeBans",
        count(*) filter (where action = 'ban' and ended_at is null and voided_at is null
          and expires_at > now())::int as "temporaryBans",
        count(*) filter (where action = 'warn' and voided_at is null
          and created_at >= ${since})::int as "warns30",
        count(distinct user_id) filter (where action = 'warn' and voided_at is null
          and created_at >= ${since})::int as "warned30",
        count(*) filter (where created_at >= ${since})::int as "total30",
        count(*) filter (where created_at >= ${since}
          and meta->>'source' in ('automod', 'escalation'))::int as "automated30"
      from moderation_cases
      where guild_id = ${guildId}
    `;
    return (
      row ?? {
        activeTimeouts: 0,
        timeoutEndsAt: null,
        activeBans: 0,
        temporaryBans: 0,
        warns30: 0,
        warned30: 0,
        total30: 0,
        automated30: 0,
      }
    );
  }

  #candidates(
    guildId: string,
    view: MemberView,
    search: string | null,
    limit: number,
    month: Date,
    week: Date,
  ) {
    const sql = this.sql;
    if (search && /^\d{1,20}$/.test(search)) {
      return sql`select ${search}::bigint as user_id, now() as at`;
    }
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      return sql`
        select user_id, max(at) as at from (
          select user_id, changed_at as at from moderation_names
          where guild_id = ${guildId} and value ilike ${pattern}
          union all
          select user_id, joined_at from member_joins
          where guild_id = ${guildId} and invite_code ilike ${pattern}
        ) s group by user_id order by at desc limit ${limit}
      `;
    }
    if (view === 'new') {
      return sql`
        select user_id, joined_at as at from (
          select distinct on (user_id) user_id, joined_at, left_at from member_joins
          where guild_id = ${guildId} and joined_at >= ${month}
          order by user_id, joined_at desc
        ) j where left_at is null order by at desc limit ${limit}
      `;
    }
    if (view === 'flagged') {
      return sql`
        select user_id, max(at) as at from (
          select user_id, created_at as at from moderation_cases
          where guild_id = ${guildId} and user_id is not null and voided_at is null
          union all
          select user_id, changed_at from moderation_names
          where guild_id = ${guildId} and not baseline and changed_at >= ${month}
          union all
          select user_id, joined_at from member_joins
          where guild_id = ${guildId} and joined_at >= ${week}
        ) s group by user_id
      `;
    }
    return sql`
        select user_id, max(at) as at from (
          select user_id, created_at as at from moderation_cases
          where guild_id = ${guildId} and user_id is not null
          union all
          select user_id, created_at from moderation_notes
          where guild_id = ${guildId} and deleted_at is null
          union all
          select user_id, changed_at from moderation_names
          where guild_id = ${guildId} and not baseline
          union all
          select user_id, joined_at from member_joins where guild_id = ${guildId}
        ) s group by user_id order by at desc limit ${limit}
      `;
  }

  async memberList(
    guildId: string,
    options: {
      view: MemberView;
      search?: string | null;
      expiryDays: number | null;
      limit?: number;
    },
  ): Promise<MemberListRow[]> {
    const sql = this.sql;
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
    const now = Date.now();
    const cutoff = expiryCutoff(options.expiryDays, now) ?? new Date(0);
    const month = new Date(now - 30 * 86_400_000);
    const week = new Date(now - 7 * 86_400_000);
    const search = options.search?.trim() || null;
    const flagged = !search && options.view === 'flagged';
    const candidates = this.#candidates(guildId, options.view, search, limit, month, week);
    return sql<MemberListRow[]>`
      select * from (
        select p.user_id::text as "userId", p.at as "lastAt",
          j.joined_at as "joinedAt", j.left_at as "leftAt",
          (select n.value from moderation_names n
            where n.guild_id = ${guildId} and n.user_id = p.user_id and n.kind = 'username'
              and n.value is not null
            order by n.changed_at desc, n.id desc limit 1) as username,
          (select n.value from moderation_names n
            where n.guild_id = ${guildId} and n.user_id = p.user_id and n.kind = 'display'
              and n.value is not null
            order by n.changed_at desc, n.id desc limit 1) as display,
          (select count(*) from moderation_cases c
            where c.guild_id = ${guildId} and c.user_id = p.user_id and c.action = 'warn'
              and c.voided_at is null and c.created_at > ${cutoff})::int as "activeWarns",
          exists(select 1 from moderation_cases c
            where c.guild_id = ${guildId} and c.user_id = p.user_id and c.action = 'ban'
              and c.ended_at is null and c.voided_at is null
              and (c.expires_at is null or c.expires_at > now())) as banned,
          exists(select 1 from moderation_cases c
            where c.guild_id = ${guildId} and c.user_id = p.user_id and c.action = 'timeout'
              and c.ended_at is null and c.voided_at is null and c.expires_at > now()) as "timedOut",
          exists(select 1 from moderation_cases c
            where c.guild_id = ${guildId} and c.user_id = p.user_id and c.action = 'flag'
              and c.ended_at is null and c.voided_at is null) as review,
          (select count(*) from moderation_names n
            where n.guild_id = ${guildId} and n.user_id = p.user_id and not n.baseline
              and n.changed_at >= ${month})::int as "nameChanges",
          coalesce(j.joined_at >= ${week} and j.joined_at - to_timestamp(
            ((p.user_id >> 22) + 1420070400000)::float8 / 1000
          ) < interval '7 days', false) as "newAccount"
        from (${candidates}) p
        left join lateral (
          select m.joined_at, m.left_at from member_joins m
          where m.guild_id = ${guildId} and m.user_id = p.user_id
          order by m.joined_at desc limit 1
        ) j on true
      ) r
      ${
        flagged
          ? sql`where "activeWarns" > 0 or banned or "timedOut" or review or "nameChanges" >= 3 or "newAccount"`
          : sql``
      }
      order by "lastAt" desc
      limit ${limit}
    `;
  }

  async joins(guildId: string, userId: string, limit = 20): Promise<JoinRow[]> {
    return this.sql<JoinRow[]>`
      select joined_at as "joinedAt", left_at as "leftAt", invite_code as "inviteCode",
        inviter_id::text as "inviterId", join_source as "joinSource"
      from member_joins
      where guild_id = ${guildId} and user_id = ${userId}
      order by joined_at desc
      limit ${Math.min(Math.max(limit, 1), 100)}
    `;
  }

  async automodHits(guildId: string, userId: string): Promise<number> {
    const [row] = await this.sql<{ total: number }[]>`
      select count(*)::int as total from automod_hits
      where guild_id = ${guildId} and user_id = ${userId}
    `;
    return row?.total ?? 0;
  }

  async invited(guildId: string, userId: string): Promise<{ total: number; stayed: number }> {
    const [row] = await this.sql<{ total: number; stayed: number }[]>`
      select count(*)::int as total, count(*) filter (where left_at is null)::int as stayed
      from (
        select distinct on (user_id) user_id, left_at from member_joins
        where guild_id = ${guildId} and inviter_id = ${userId} and user_id <> ${userId}
        order by user_id, joined_at desc
      ) s
    `;
    return row ?? { total: 0, stayed: 0 };
  }

  async activeWarns(
    guildId: string,
    userId: string,
    expiryDays: number | null,
    since?: Date,
  ): Promise<CaseRow[]> {
    const cutoff = expiryCutoff(expiryDays);
    const from =
      cutoff && since ? (cutoff > since ? cutoff : since) : (cutoff ?? since ?? new Date(0));
    return this.sql<CaseRow[]>`
      select ${caseColumns(this.sql)} from moderation_cases
      where guild_id = ${guildId} and user_id = ${userId} and action = 'warn'
        and voided_at is null and created_at > ${from}
      order by number desc
    `;
  }

  async openCase(guildId: string, userId: string, action: CaseAction): Promise<CaseRow | null> {
    const [row] = await this.sql<CaseRow[]>`
      select ${caseColumns(this.sql)} from moderation_cases
      where guild_id = ${guildId} and user_id = ${userId} and action = ${action}
        and ended_at is null and voided_at is null
        and (expires_at is null or expires_at > now())
      order by number desc
      limit 1
    `;
    return row ?? null;
  }

  async setReason(
    guildId: string,
    number: number,
    reason: string | null,
    editorId: string | null,
  ): Promise<{ before: string | null; claimed: boolean } | null> {
    const [row] = await this.sql<{ before: string | null; claimed: boolean }[]>`
      update moderation_cases c set
        reason = ${reason},
        edited_by = ${editorId},
        edited_at = now(),
        moderator_id = coalesce(c.moderator_id, ${editorId})
      from (
        select reason, moderator_id from moderation_cases
        where guild_id = ${guildId} and number = ${number}
        for update
      ) old
      where c.guild_id = ${guildId} and c.number = ${number}
      returning old.reason as before, (old.moderator_id is null and ${editorId}::bigint is not null) as claimed
    `;
    return row ?? null;
  }

  async restoreReason(
    guildId: string,
    number: number,
    reason: string | null,
    unclaim: boolean,
  ): Promise<void> {
    await this.sql`
      update moderation_cases set
        reason = ${reason},
        moderator_id = case when ${unclaim} then null else moderator_id end,
        edited_at = now()
      where guild_id = ${guildId} and number = ${number}
    `;
  }

  async addEvidence(guildId: string, number: number, url: string): Promise<boolean> {
    const rows = await this.sql`
      update moderation_cases set evidence = array_append(evidence, ${url})
      where guild_id = ${guildId} and number = ${number} and not (${url} = any(evidence))
        and coalesce(array_length(evidence, 1), 0) < 20
      returning number
    `;
    return rows.length > 0;
  }

  async removeEvidence(guildId: string, number: number, url: string): Promise<boolean> {
    const rows = await this.sql`
      update moderation_cases set evidence = array_remove(evidence, ${url})
      where guild_id = ${guildId} and number = ${number} and ${url} = any(evidence)
      returning number
    `;
    return rows.length > 0;
  }

  async setLogMessage(
    guildId: string,
    number: number,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    await this.sql`
      update moderation_cases set log_channel_id = ${channelId}, log_message_id = ${messageId}
      where guild_id = ${guildId} and number = ${number}
    `;
  }

  async setMeta(guildId: string, number: number, patch: Record<string, unknown>): Promise<void> {
    await this.sql`
      update moderation_cases set meta = meta || ${this.sql.json(patch as never)}
      where guild_id = ${guildId} and number = ${number}
    `;
  }

  async voidCase(
    guildId: string,
    number: number,
    by: string | null,
    reason: string | null,
  ): Promise<boolean> {
    const rows = await this.sql`
      update moderation_cases set voided_at = now(), voided_by = ${by}, void_reason = ${reason}
      where guild_id = ${guildId} and number = ${number} and voided_at is null
      returning number
    `;
    return rows.length > 0;
  }

  async voidMany(
    guildId: string,
    numbers: readonly number[],
    by: string | null,
    reason: string | null,
  ): Promise<number[]> {
    if (numbers.length === 0) return [];
    const rows = await this.sql<{ number: number }[]>`
      update moderation_cases set voided_at = now(), voided_by = ${by}, void_reason = ${reason}
      where guild_id = ${guildId} and number = any(${this.sql.array(numbers as number[])}::int[]) and voided_at is null
      returning number
    `;
    return rows.map((row) => row.number);
  }

  async unvoid(guildId: string, numbers: readonly number[]): Promise<number> {
    if (numbers.length === 0) return 0;
    const rows = await this.sql`
      update moderation_cases set voided_at = null, voided_by = null, void_reason = null
      where guild_id = ${guildId} and number = any(${this.sql.array(numbers as number[])}::int[])
      returning number
    `;
    return rows.length;
  }

  async end(guildId: string, number: number): Promise<boolean> {
    const rows = await this.sql`
      update moderation_cases set ended_at = now()
      where guild_id = ${guildId} and number = ${number} and ended_at is null
      returning number
    `;
    return rows.length > 0;
  }

  async overdue(before: Date, limit = 100): Promise<CaseRow[]> {
    return this.sql<CaseRow[]>`
      select ${caseColumns(this.sql)} from moderation_cases
      where expires_at is not null and expires_at <= ${before}
        and ended_at is null and voided_at is null
      order by expires_at
      limit ${limit}
    `;
  }

  async summary(
    guildId: string,
    userId: string,
    expiryDays: number | null,
  ): Promise<MemberSummary> {
    const cutoff = expiryCutoff(expiryDays) ?? new Date(0);
    const rows = await this.sql<{ action: CaseAction; total: number; active: number }[]>`
      select action, count(*)::int as total,
        count(*) filter (where action = 'warn' and created_at > ${cutoff})::int as active
      from moderation_cases
      where guild_id = ${guildId} and user_id = ${userId} and voided_at is null
      group by action
    `;
    const [extra] = await this.sql<{ notes: number; names: number }[]>`
      select
        (select count(*)::int from moderation_notes
          where guild_id = ${guildId} and user_id = ${userId} and deleted_at is null) as notes,
        (select count(*)::int from moderation_names
          where guild_id = ${guildId} and user_id = ${userId} and not baseline) as names
    `;
    const actions: Partial<Record<CaseAction, number>> = {};
    let total = 0;
    let activeWarns = 0;
    for (const row of rows) {
      actions[row.action] = row.total;
      total += row.total;
      activeWarns += row.active;
    }
    return {
      total,
      actions,
      activeWarns,
      notes: extra?.notes ?? 0,
      nameChanges: extra?.names ?? 0,
    };
  }

  async moderators(
    guildId: string,
    since: Date,
  ): Promise<{ moderatorId: string; total: number }[]> {
    return this.sql<{ moderatorId: string; total: number }[]>`
      select moderator_id::text as "moderatorId", count(*)::int as total
      from moderation_cases
      where guild_id = ${guildId} and moderator_id is not null and created_at >= ${since}
      group by moderator_id
      order by total desc
    `;
  }

  async deleteBefore(guildId: string, before: Date): Promise<number> {
    const rows = await this.sql`
      delete from moderation_cases where guild_id = ${guildId} and created_at < ${before}
      returning number
    `;
    return rows.length;
  }

  async guildsWithCases(): Promise<string[]> {
    const rows = await this.sql<{ guildId: string }[]>`
      select distinct guild_id::text as "guildId" from moderation_cases
    `;
    return rows.map((row) => row.guildId);
  }

  async addNote(
    guildId: string,
    userId: string,
    authorId: string | null,
    body: string,
  ): Promise<NoteRow> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`moderation.notes:${guildId}`}))`;
      const [row] = await tx<NoteRow[]>`
        insert into moderation_notes (guild_id, number, user_id, author_id, body)
        values (
          ${guildId},
          (select coalesce(max(number), 0) + 1 from moderation_notes where guild_id = ${guildId}),
          ${userId}, ${authorId}, ${body}
        )
        returning id::text, number, guild_id::text as "guildId", user_id::text as "userId",
          author_id::text as "authorId", body, created_at as "createdAt"
      `;
      if (!row) throw new Error('note insert returned nothing');
      return row;
    });
  }

  async noteByNumber(guildId: string, number: number): Promise<NoteRow | null> {
    if (!Number.isSafeInteger(number) || number < 1 || number > 2_147_483_647) return null;
    const [row] = await this.sql<NoteRow[]>`
      select id::text, number, guild_id::text as "guildId", user_id::text as "userId",
        author_id::text as "authorId", body, created_at as "createdAt"
      from moderation_notes
      where guild_id = ${guildId} and number = ${number} and deleted_at is null
    `;
    return row ?? null;
  }

  async notes(guildId: string, userId: string, limit = 50): Promise<NoteRow[]> {
    return this.sql<NoteRow[]>`
      select id::text, number, guild_id::text as "guildId", user_id::text as "userId",
        author_id::text as "authorId", body, created_at as "createdAt"
      from moderation_notes
      where guild_id = ${guildId} and user_id = ${userId} and deleted_at is null
      order by created_at desc, id desc
      limit ${Math.min(Math.max(limit, 1), 200)}
    `;
  }

  async deleteNote(guildId: string, id: string): Promise<boolean> {
    const rows = await this.sql`
      update moderation_notes set deleted_at = now()
      where guild_id = ${guildId} and id = ${id} and deleted_at is null
      returning id
    `;
    return rows.length > 0;
  }

  async restoreNote(guildId: string, id: string): Promise<boolean> {
    const rows = await this.sql`
      update moderation_notes set deleted_at = null
      where guild_id = ${guildId} and id = ${id} and deleted_at is not null
      returning id
    `;
    return rows.length > 0;
  }

  async lastName(guildId: string, userId: string, kind: NameKind): Promise<NameRow | null> {
    const [row] = await this.sql<NameRow[]>`
      select id::text, kind, value, previous, baseline, changed_at as "changedAt"
      from moderation_names
      where guild_id = ${guildId} and user_id = ${userId} and kind = ${kind}
      order by changed_at desc, id desc
      limit 1
    `;
    return row ?? null;
  }

  async recordName(
    guildId: string,
    userId: string,
    kind: NameKind,
    value: string | null,
    previous: string | null,
    baseline: boolean,
  ): Promise<void> {
    await this.sql`
      insert into moderation_names (guild_id, user_id, kind, value, previous, baseline)
      values (${guildId}, ${userId}, ${kind}, ${value}, ${previous}, ${baseline})
    `;
  }

  async nameHistory(guildId: string, userId: string, limit = 25): Promise<NameRow[]> {
    return this.sql<NameRow[]>`
      select id::text, kind, value, previous, baseline, changed_at as "changedAt"
      from moderation_names
      where guild_id = ${guildId} and user_id = ${userId} and not baseline
      order by changed_at desc, id desc
      limit ${Math.min(Math.max(limit, 1), 200)}
    `;
  }

  async nameChanges(guildId: string, userId: string, since: Date): Promise<number> {
    const [row] = await this.sql<{ total: number }[]>`
      select count(*)::int as total from moderation_names
      where guild_id = ${guildId} and user_id = ${userId} and not baseline and changed_at >= ${since}
    `;
    return row?.total ?? 0;
  }

  async pruneNames(before: Date): Promise<number> {
    const rows = await this.sql`
      delete from moderation_names where changed_at < ${before} and not baseline
      returning id
    `;
    return rows.length;
  }

  async saveLock(lock: Omit<LockRow, 'createdAt'>): Promise<void> {
    await this.sql`
      insert into moderation_locks (
        guild_id, channel_id, changes, moderator_id, reason, ends_at
      ) values (
        ${lock.guildId}, ${lock.channelId}, ${this.sql.json(lock.changes as never)},
        ${lock.moderatorId}, ${lock.reason}, ${lock.endsAt}
      )
      on conflict (guild_id, channel_id) do update set
        changes = excluded.changes,
        moderator_id = excluded.moderator_id, reason = excluded.reason,
        ends_at = excluded.ends_at, created_at = now()
    `;
  }

  async lock(guildId: string, channelId: string): Promise<LockRow | null> {
    const [row] = await this.sql<LockRow[]>`
      select guild_id::text as "guildId", channel_id::text as "channelId", changes,
        moderator_id::text as "moderatorId", reason, ends_at as "endsAt", created_at as "createdAt"
      from moderation_locks where guild_id = ${guildId} and channel_id = ${channelId}
    `;
    return row ?? null;
  }

  async locks(guildId: string): Promise<LockRow[]> {
    return this.sql<LockRow[]>`
      select guild_id::text as "guildId", channel_id::text as "channelId", changes,
        moderator_id::text as "moderatorId", reason, ends_at as "endsAt", created_at as "createdAt"
      from moderation_locks where guild_id = ${guildId}
      order by created_at desc
    `;
  }

  async deleteLock(guildId: string, channelId: string): Promise<boolean> {
    const rows = await this.sql`
      delete from moderation_locks where guild_id = ${guildId} and channel_id = ${channelId}
      returning channel_id
    `;
    return rows.length > 0;
  }

  async recentExternal(
    guildId: string,
    userId: string,
    action: CaseAction,
    since: Date,
  ): Promise<CaseRow | null> {
    const [row] = await this.sql<CaseRow[]>`
      select ${caseColumns(this.sql)} from moderation_cases
      where guild_id = ${guildId} and user_id = ${userId} and action = ${action}
        and moderator_id is null and meta->>'source' = 'external' and created_at >= ${since}
      order by number desc
      limit 1
    `;
    return row ?? null;
  }

  async attribute(
    guildId: string,
    number: number,
    moderatorId: string | null,
    reason: string | null,
  ): Promise<boolean> {
    const rows = await this.sql`
      update moderation_cases set
        moderator_id = coalesce(moderator_id, ${moderatorId}),
        reason = coalesce(reason, ${reason})
      where guild_id = ${guildId} and number = ${number}
      returning number
    `;
    return rows.length > 0;
  }

  async memberExport(guildId: string, userId: string): Promise<MemberExport> {
    const cases = await this.sql<CaseRow[]>`
      select ${caseColumns(this.sql)} from moderation_cases
      where guild_id = ${guildId} and user_id = ${userId}
      order by number
    `;
    const names = await this.sql<NameRow[]>`
      select id::text, kind, value, previous, baseline, changed_at as "changedAt"
      from moderation_names
      where guild_id = ${guildId} and user_id = ${userId}
      order by changed_at, id
    `;
    const [extra] = await this.sql<{ notes: number; issued: number }[]>`
      select
        (select count(*)::int from moderation_notes
          where guild_id = ${guildId} and user_id = ${userId} and deleted_at is null) as notes,
        (select count(*)::int from moderation_cases
          where guild_id = ${guildId} and moderator_id = ${userId}) as issued
    `;
    return { cases, names, notes: extra?.notes ?? 0, issued: extra?.issued ?? 0 };
  }

  async forgetMember(guildId: string, userId: string): Promise<void> {
    await this
      .sql`delete from moderation_notes where guild_id = ${guildId} and user_id = ${userId}`;
    await this
      .sql`delete from moderation_names where guild_id = ${guildId} and user_id = ${userId}`;
  }
}
