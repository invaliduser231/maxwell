import type { Sql } from '../db/sql.js';
import {
  INSIGHTS_RETENTION_DEFAULT,
  moderationModules,
  NATIVE_MODULE,
  type NativeAction,
} from '../modules/insights.js';

export interface MessageRow {
  guildId: string;
  hour: Date;
  channelId: string;
  count: number;
}

export interface ActiveRow {
  guildId: string;
  day: string;
  userId: string;
  count: number;
}

export interface MemberRow {
  guildId: string;
  day: string;
  joins: number;
  leaves: number;
}

export interface VoiceRow {
  guildId: string;
  day: string;
  channelId: string;
  seconds: number;
}

export interface ModerationRow {
  guildId: string;
  day: string;
  action: NativeAction;
  actorId: string | null;
  count: number;
}

export interface InsightsBatch {
  messages: MessageRow[];
  active: ActiveRow[];
  members: MemberRow[];
  voice: VoiceRow[];
  moderation?: ModerationRow[];
}

export interface MemberInsights {
  activity: { day: string; messages: number }[];
  moderation: { day: string; action: string; count: number }[];
}

export interface Range {
  from: Date;
  to: Date;
}

export interface TimePoint {
  at: string;
  messages: number;
}

export interface DayCount {
  day: string;
  count: number;
}

export interface MemberFlow {
  day: string;
  joins: number;
  leaves: number;
}

export interface ChannelCount {
  channelId: string;
  count: number;
}

export interface HeatCell {
  weekday: number;
  hour: number;
  messages: number;
}

export interface ModerationLoad {
  day: string;
  module: string;
  action: string;
  count: number;
}

export interface ModeratorLoad {
  actorId: string | null;
  count: number;
}

export interface InviteRetention {
  inviteCode: string | null;
  inviterId: string | null;
  joins: number;
  eligible7: number;
  stayed7: number;
  eligible30: number;
  stayed30: number;
  active30: number;
}

export interface InsightsSummary {
  messages: number;
  activeMembers: number;
  joins: number;
  leaves: number;
  voiceMinutes: number;
  moderationActions: number;
}

const CHUNK = 500;

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function hourStart(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 3_600_000) * 3_600_000);
}

export function safeTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    return 'UTC';
  }
}

function chunks<T>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

export class InsightsStore {
  constructor(private readonly sql: Sql) {}

  async write(batch: InsightsBatch): Promise<number> {
    let written = 0;
    await this.sql.begin(async (tx) => {
      for (const group of chunks(batch.messages)) {
        const rows = group.map((row) => ({
          guild_id: row.guildId,
          hour: row.hour,
          channel_id: row.channelId,
          messages: row.count,
        }));
        await tx`
          insert into insights_messages ${tx(rows)}
          on conflict (guild_id, hour, channel_id)
          do update set messages = insights_messages.messages + excluded.messages
        `;
        written += rows.length;
      }
      for (const group of chunks(batch.active)) {
        const rows = group.map((row) => ({
          guild_id: row.guildId,
          day: row.day,
          user_id: row.userId,
          messages: row.count,
        }));
        await tx`
          insert into insights_active ${tx(rows)}
          on conflict (guild_id, day, user_id)
          do update set messages = insights_active.messages + excluded.messages
        `;
        written += rows.length;
      }
      for (const group of chunks(batch.members)) {
        const rows = group.map((row) => ({
          guild_id: row.guildId,
          day: row.day,
          joins: row.joins,
          leaves: row.leaves,
        }));
        await tx`
          insert into insights_members ${tx(rows)}
          on conflict (guild_id, day) do update set
            joins = insights_members.joins + excluded.joins,
            leaves = insights_members.leaves + excluded.leaves
        `;
        written += rows.length;
      }
      for (const group of chunks(batch.voice)) {
        const rows = group.map((row) => ({
          guild_id: row.guildId,
          day: row.day,
          channel_id: row.channelId,
          seconds: Math.round(row.seconds),
        }));
        await tx`
          insert into insights_voice ${tx(rows)}
          on conflict (guild_id, day, channel_id)
          do update set seconds = insights_voice.seconds + excluded.seconds
        `;
        written += rows.length;
      }
      for (const group of chunks(batch.moderation ?? [])) {
        const rows = group.map((row) => ({
          guild_id: row.guildId,
          day: row.day,
          action: row.action,
          actor_id: row.actorId ?? '0',
          count: row.count,
        }));
        await tx`
          insert into insights_moderation ${tx(rows)}
          on conflict (guild_id, day, action, actor_id)
          do update set count = insights_moderation.count + excluded.count
        `;
        written += rows.length;
      }
    });
    return written;
  }

  async summary(guildId: string, range: Range): Promise<InsightsSummary> {
    const fromDay = utcDay(range.from);
    const toDay = utcDay(range.to);
    const [row] = await this.sql<InsightsSummary[]>`
      select
        (select coalesce(sum(messages), 0)::int from insights_messages
          where guild_id = ${guildId} and hour >= ${range.from} and hour < ${range.to}) as messages,
        (select count(distinct user_id)::int from insights_active
          where guild_id = ${guildId} and day >= ${fromDay}::date and day < ${toDay}::date)
          as "activeMembers",
        (select coalesce(sum(joins), 0)::int from insights_members
          where guild_id = ${guildId} and day >= ${fromDay}::date and day < ${toDay}::date) as joins,
        (select coalesce(sum(leaves), 0)::int from insights_members
          where guild_id = ${guildId} and day >= ${fromDay}::date and day < ${toDay}::date) as leaves,
        (select (coalesce(sum(seconds), 0) / 60)::int from insights_voice
          where guild_id = ${guildId} and day >= ${fromDay}::date and day < ${toDay}::date)
          as "voiceMinutes",
        ((select count(*)::int from audit_entries
          where guild_id = ${guildId} and module = any(${this.sql.array([...moderationModules])}::text[])
            and created_at >= ${range.from} and created_at < ${range.to})
        + (select coalesce(sum(count), 0)::int from insights_moderation
          where guild_id = ${guildId} and day >= ${fromDay}::date and day < ${toDay}::date))
          as "moderationActions"
    `;
    return (
      row ?? {
        messages: 0,
        activeMembers: 0,
        joins: 0,
        leaves: 0,
        voiceMinutes: 0,
        moderationActions: 0,
      }
    );
  }

  async messages(
    guildId: string,
    range: Range,
    bucket: 'hour' | 'day' = 'day',
    timezone = 'UTC',
  ): Promise<TimePoint[]> {
    const tz = safeTimezone(timezone);
    const format = bucket === 'hour' ? 'YYYY-MM-DD"T"HH24:00' : 'YYYY-MM-DD';
    return this.sql<TimePoint[]>`
      select to_char(date_trunc(${bucket}, hour at time zone ${tz}), ${format}) as at,
        sum(messages)::int as messages
      from insights_messages
      where guild_id = ${guildId} and hour >= ${range.from} and hour < ${range.to}
      group by 1
      order by 1
    `;
  }

  async topChannels(guildId: string, range: Range, limit = 10): Promise<ChannelCount[]> {
    return this.sql<ChannelCount[]>`
      select channel_id as "channelId", sum(messages)::int as count
      from insights_messages
      where guild_id = ${guildId} and hour >= ${range.from} and hour < ${range.to}
      group by channel_id
      order by count desc
      limit ${Math.min(Math.max(limit, 1), 50)}
    `;
  }

  async activeMembers(guildId: string, range: Range): Promise<DayCount[]> {
    return this.sql<DayCount[]>`
      select to_char(day, 'YYYY-MM-DD') as day, count(*)::int as count
      from insights_active
      where guild_id = ${guildId} and day >= ${utcDay(range.from)}::date
        and day < ${utcDay(range.to)}::date
      group by day
      order by day
    `;
  }

  async topMembers(
    guildId: string,
    range: Range,
    limit = 10,
  ): Promise<{ userId: string; count: number }[]> {
    return this.sql<{ userId: string; count: number }[]>`
      select user_id as "userId", sum(messages)::int as count
      from insights_active
      where guild_id = ${guildId} and day >= ${utcDay(range.from)}::date
        and day < ${utcDay(range.to)}::date
      group by user_id
      order by count desc
      limit ${Math.min(Math.max(limit, 1), 50)}
    `;
  }

  async memberFlow(guildId: string, range: Range): Promise<MemberFlow[]> {
    return this.sql<MemberFlow[]>`
      select to_char(day, 'YYYY-MM-DD') as day, joins, leaves
      from insights_members
      where guild_id = ${guildId} and day >= ${utcDay(range.from)}::date
        and day < ${utcDay(range.to)}::date
      order by day
    `;
  }

  async voiceMinutes(guildId: string, range: Range): Promise<DayCount[]> {
    return this.sql<DayCount[]>`
      select to_char(day, 'YYYY-MM-DD') as day, (sum(seconds) / 60)::int as count
      from insights_voice
      where guild_id = ${guildId} and day >= ${utcDay(range.from)}::date
        and day < ${utcDay(range.to)}::date
      group by day
      order by day
    `;
  }

  async topVoiceChannels(guildId: string, range: Range, limit = 10): Promise<ChannelCount[]> {
    return this.sql<ChannelCount[]>`
      select channel_id as "channelId", (sum(seconds) / 60)::int as count
      from insights_voice
      where guild_id = ${guildId} and day >= ${utcDay(range.from)}::date
        and day < ${utcDay(range.to)}::date
      group by channel_id
      order by count desc
      limit ${Math.min(Math.max(limit, 1), 50)}
    `;
  }

  async heatmap(guildId: string, range: Range, timezone = 'UTC'): Promise<HeatCell[]> {
    const tz = safeTimezone(timezone);
    return this.sql<HeatCell[]>`
      select (extract(isodow from hour at time zone ${tz})::int - 1) as weekday,
        extract(hour from hour at time zone ${tz})::int as hour,
        sum(messages)::int as messages
      from insights_messages
      where guild_id = ${guildId} and hour >= ${range.from} and hour < ${range.to}
      group by 1, 2
      order by 1, 2
    `;
  }

  async moderationLoad(guildId: string, range: Range): Promise<ModerationLoad[]> {
    return this.sql<ModerationLoad[]>`
      select day, module, action, sum(count)::int as count from (
        select to_char((created_at at time zone 'UTC')::date, 'YYYY-MM-DD') as day,
          module, action, 1 as count
        from audit_entries
        where guild_id = ${guildId} and module = any(${this.sql.array([...moderationModules])}::text[])
          and created_at >= ${range.from} and created_at < ${range.to}
        union all
        select to_char(day, 'YYYY-MM-DD'), ${NATIVE_MODULE}::text, action, count
        from insights_moderation
        where guild_id = ${guildId} and day >= ${utcDay(range.from)}::date
          and day < ${utcDay(range.to)}::date
      ) load
      group by 1, 2, 3
      order by 1, 2, 3
    `;
  }

  async moderators(guildId: string, range: Range, limit = 10): Promise<ModeratorLoad[]> {
    return this.sql<ModeratorLoad[]>`
      select actor_id as "actorId", sum(count)::int as count from (
        select actor_id, 1 as count
        from audit_entries
        where guild_id = ${guildId} and module = any(${this.sql.array([...moderationModules])}::text[])
          and created_at >= ${range.from} and created_at < ${range.to}
        union all
        select nullif(actor_id, 0), count
        from insights_moderation
        where guild_id = ${guildId} and day >= ${utcDay(range.from)}::date
          and day < ${utcDay(range.to)}::date
      ) load
      group by actor_id
      order by count desc, actor_id nulls last
      limit ${Math.min(Math.max(limit, 1), 50)}
    `;
  }

  async inviteRetention(guildId: string, range: Range, limit = 25): Promise<InviteRetention[]> {
    return this.sql<InviteRetention[]>`
      select j.invite_code as "inviteCode", min(j.inviter_id) as "inviterId",
        count(*)::int as joins,
        count(*) filter (where j.joined_at <= now() - interval '7 days')::int as eligible7,
        count(*) filter (
          where j.joined_at <= now() - interval '7 days'
            and (j.left_at is null or j.left_at > j.joined_at + interval '7 days')
        )::int as stayed7,
        count(*) filter (where j.joined_at <= now() - interval '30 days')::int as eligible30,
        count(*) filter (
          where j.joined_at <= now() - interval '30 days'
            and (j.left_at is null or j.left_at > j.joined_at + interval '30 days')
        )::int as stayed30,
        count(*) filter (
          where j.joined_at <= now() - interval '30 days'
            and exists (
              select 1 from insights_active a
              where a.guild_id = j.guild_id and a.user_id = j.user_id
                and a.day >= (j.joined_at at time zone 'UTC')::date + 7
                and a.day <= (j.joined_at at time zone 'UTC')::date + 30
            )
        )::int as active30
      from member_joins j
      where j.guild_id = ${guildId} and j.joined_at >= ${range.from} and j.joined_at < ${range.to}
        and j.resolved_at is not null and j.inviter_id is distinct from j.user_id
      group by j.invite_code
      order by joins desc
      limit ${Math.min(Math.max(limit, 1), 100)}
    `;
  }

  async member(guildId: string, userId: string): Promise<MemberInsights> {
    const [activity, moderation] = await Promise.all([
      this.sql<{ day: string; messages: number }[]>`
        select to_char(day, 'YYYY-MM-DD') as day, messages
        from insights_active
        where guild_id = ${guildId} and user_id = ${userId}
        order by day
      `,
      this.sql<{ day: string; action: string; count: number }[]>`
        select to_char(day, 'YYYY-MM-DD') as day, action, count
        from insights_moderation
        where guild_id = ${guildId} and actor_id = ${userId}
        order by day, action
      `,
    ]);
    return { activity: [...activity], moderation: [...moderation] };
  }

  async forgetUser(guildId: string, userId: string): Promise<void> {
    if (userId === '0') return;
    await this.sql.begin(async (tx) => {
      await tx`delete from insights_active where guild_id = ${guildId} and user_id = ${userId}`;
      await tx`
        with gone as (
          delete from insights_moderation
          where guild_id = ${guildId} and actor_id = ${userId}
          returning day, action, count
        )
        insert into insights_moderation (guild_id, day, action, actor_id, count)
        select ${guildId}, day, action, 0, count from gone
        on conflict (guild_id, day, action, actor_id)
        do update set count = insights_moderation.count + excluded.count
      `;
    });
  }

  async forgetGuild(guildId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`delete from insights_messages where guild_id = ${guildId}`;
      await tx`delete from insights_active where guild_id = ${guildId}`;
      await tx`delete from insights_members where guild_id = ${guildId}`;
      await tx`delete from insights_voice where guild_id = ${guildId}`;
      await tx`delete from insights_moderation where guild_id = ${guildId}`;
    });
  }

  async prune(): Promise<number> {
    const retention = () => this.sql`
      make_interval(days => coalesce((
        select case when (g.config->>'retentionDays') ~ '^[0-9]{1,4}$'
          then (g.config->>'retentionDays')::int end
        from guild_modules g
        where g.guild_id = t.guild_id and g.module = 'insights'
      ), ${INSIGHTS_RETENTION_DEFAULT}::int))
    `;
    let removed = 0;
    const tables: [string, string][] = [
      ['insights_messages', 'hour'],
      ['insights_active', 'day'],
      ['insights_members', 'day'],
      ['insights_voice', 'day'],
      ['insights_moderation', 'day'],
    ];
    for (const [table, column] of tables) {
      const result = await this.sql`
        delete from ${this.sql(table)} t
        where t.${this.sql(column)} < now() - ${retention()}
      `;
      removed += result.count;
    }
    return removed;
  }
}
