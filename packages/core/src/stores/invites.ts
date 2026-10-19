import type { Sql } from '../db/sql.js';

export interface InviteSummary {
  joins30: number;
  fake30: number;
  eligible7: number;
  stayed7: number;
  eligible30: number;
  stayed30: number;
}

export interface InviteCodeStats {
  code: string;
  inviterId: string | null;
  vanity: boolean;
  joins: number;
  joins30: number;
  fake: number;
  eligible7: number;
  stayed7: number;
  eligible30: number;
  stayed30: number;
  lastJoinAt: Date;
}

export interface InviteJoin {
  userId: string;
  joinedAt: Date;
  leftAt: Date | null;
  fake: boolean;
}

export interface InviterRow {
  inviterId: string;
  active: number;
  total: number;
  fake: number;
}

const WINDOW_DAYS = 90;

export class InviteStatsStore {
  constructor(private readonly sql: Sql) {}

  #fake() {
    return this.sql`(
      j.joined_at - to_timestamp(((j.user_id >> 22) + 1420070400000)::float8 / 1000)
    ) < interval '1 day'`;
  }

  async summary(guildId: string): Promise<InviteSummary> {
    const [row] = await this.sql<InviteSummary[]>`
      select
        count(*) filter (where j.joined_at >= now() - interval '30 days')::int as "joins30",
        count(*) filter (
          where j.joined_at >= now() - interval '30 days' and ${this.#fake()}
        )::int as "fake30",
        count(*) filter (where j.joined_at <= now() - interval '7 days')::int as "eligible7",
        count(*) filter (
          where j.joined_at <= now() - interval '7 days'
            and (j.left_at is null or j.left_at > j.joined_at + interval '7 days')
        )::int as "stayed7",
        count(*) filter (where j.joined_at <= now() - interval '30 days')::int as "eligible30",
        count(*) filter (
          where j.joined_at <= now() - interval '30 days'
            and (j.left_at is null or j.left_at > j.joined_at + interval '30 days')
        )::int as "stayed30"
      from member_joins j
      where j.guild_id = ${guildId}
        and j.joined_at >= now() - make_interval(days => ${WINDOW_DAYS})
        and j.invite_code is not null
        and j.inviter_id is distinct from j.user_id
    `;
    return row ?? { joins30: 0, fake30: 0, eligible7: 0, stayed7: 0, eligible30: 0, stayed30: 0 };
  }

  async codes(guildId: string, limit = 100): Promise<InviteCodeStats[]> {
    return this.sql<InviteCodeStats[]>`
      select j.invite_code as code,
        (array_agg(j.inviter_id::text order by j.joined_at desc)
          filter (where j.inviter_id is not null))[1] as "inviterId",
        bool_or(j.join_source = 2) as vanity,
        count(*)::int as joins,
        count(*) filter (where j.joined_at >= now() - interval '30 days')::int as "joins30",
        count(*) filter (where ${this.#fake()})::int as fake,
        count(*) filter (where j.joined_at <= now() - interval '7 days')::int as "eligible7",
        count(*) filter (
          where j.joined_at <= now() - interval '7 days'
            and (j.left_at is null or j.left_at > j.joined_at + interval '7 days')
        )::int as "stayed7",
        count(*) filter (where j.joined_at <= now() - interval '30 days')::int as "eligible30",
        count(*) filter (
          where j.joined_at <= now() - interval '30 days'
            and (j.left_at is null or j.left_at > j.joined_at + interval '30 days')
        )::int as "stayed30",
        max(j.joined_at) as "lastJoinAt"
      from member_joins j
      where j.guild_id = ${guildId}
        and j.joined_at >= now() - make_interval(days => ${WINDOW_DAYS})
        and j.invite_code is not null
        and j.inviter_id is distinct from j.user_id
      group by j.invite_code
      order by joins desc, "lastJoinAt" desc
      limit ${Math.min(Math.max(limit, 1), 200)}
    `;
  }

  async recent(guildId: string, code: string, limit = 6): Promise<InviteJoin[]> {
    return this.sql<InviteJoin[]>`
      select j.user_id::text as "userId", j.joined_at as "joinedAt", j.left_at as "leftAt",
        ${this.#fake()} as fake
      from member_joins j
      where j.guild_id = ${guildId} and j.invite_code = ${code}
      order by j.joined_at desc
      limit ${Math.min(Math.max(limit, 1), 25)}
    `;
  }

  async leaderboard(guildId: string, limit = 10): Promise<InviterRow[]> {
    return this.sql<InviterRow[]>`
      select inviter_id::text as "inviterId",
        count(*) filter (where left_at is null)::int as active,
        count(*)::int as total,
        count(*) filter (where fake)::int as fake
      from (
        select distinct on (j.user_id) j.user_id, j.inviter_id, j.left_at,
          ${this.#fake()} as fake
        from member_joins j
        where j.guild_id = ${guildId} and j.inviter_id is not null
        order by j.user_id, j.joined_at desc
      ) joins
      where inviter_id <> user_id
      group by inviter_id
      order by active desc, total desc
      limit ${Math.min(Math.max(limit, 1), 50)}
    `;
  }
}
