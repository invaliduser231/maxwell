import type { Sql } from '@maxwell/core';
import type { JoinSource } from '../../platform/types.js';

export interface JoinRow {
  id: string;
  guildId: string;
  userId: string;
  joinedAt: Date;
  leftAt: Date | null;
  joinSource: number | null;
  inviteCode: string | null;
  inviterId: string | null;
  resolvedAt: Date | null;
}

export interface InviterStats {
  total: number;
  active: number;
  left: number;
}

export interface LeaderboardRow {
  inviterId: string;
  active: number;
  total: number;
}

export class InviteStore {
  constructor(private readonly sql: Sql) {}

  async recordJoin(guildId: string, userId: string, joinedAt: Date): Promise<JoinRow | null> {
    const [row] = await this.sql<JoinRow[]>`
      insert into member_joins (guild_id, user_id, joined_at)
      values (${guildId}, ${userId}, ${joinedAt})
      on conflict (guild_id, user_id, joined_at) do nothing
      returning id, guild_id as "guildId", user_id as "userId", joined_at as "joinedAt",
        left_at as "leftAt", join_source as "joinSource", invite_code as "inviteCode",
        inviter_id as "inviterId", resolved_at as "resolvedAt"
    `;
    return row ?? null;
  }

  async resolve(id: string, source: JoinSource | null): Promise<void> {
    await this.sql`
      update member_joins set
        join_source = ${source?.type ?? null},
        invite_code = ${source?.inviteCode ?? null},
        inviter_id = ${source?.inviterId ?? null},
        resolved_at = now()
      where id = ${id}
    `;
  }

  async recordLeave(guildId: string, userId: string): Promise<void> {
    await this.sql`
      update member_joins set left_at = now()
      where id = (
        select id from member_joins
        where guild_id = ${guildId} and user_id = ${userId} and left_at is null
        order by joined_at desc
        limit 1
      )
    `;
  }

  async unresolved(since: Date): Promise<JoinRow[]> {
    return this.sql<JoinRow[]>`
      select id, guild_id as "guildId", user_id as "userId", joined_at as "joinedAt",
        left_at as "leftAt", join_source as "joinSource", invite_code as "inviteCode",
        inviter_id as "inviterId", resolved_at as "resolvedAt"
      from member_joins
      where resolved_at is null and joined_at >= ${since}
      order by joined_at
    `;
  }

  async latestJoin(guildId: string, userId: string): Promise<JoinRow | null> {
    const [row] = await this.sql<JoinRow[]>`
      select id, guild_id as "guildId", user_id as "userId", joined_at as "joinedAt",
        left_at as "leftAt", join_source as "joinSource", invite_code as "inviteCode",
        inviter_id as "inviterId", resolved_at as "resolvedAt"
      from member_joins
      where guild_id = ${guildId} and user_id = ${userId}
      order by joined_at desc
      limit 1
    `;
    return row ?? null;
  }

  async memberData(guildId: string, userId: string): Promise<Record<string, unknown> | null> {
    const joins = await this.sql`
      select joined_at as "joinedAt", left_at as "leftAt", invite_code as "inviteCode",
        inviter_id as "inviterId"
      from member_joins where guild_id = ${guildId} and user_id = ${userId}
      order by joined_at
    `;
    const stats = await this.inviterStats(guildId, userId);
    if (joins.length === 0 && stats.total === 0) return null;
    return { joins: [...joins], invited: stats };
  }

  async forget(guildId: string, userId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`delete from member_joins where guild_id = ${guildId} and user_id = ${userId}`;
      await tx`
        update member_joins set inviter_id = null
        where guild_id = ${guildId} and inviter_id = ${userId}
      `;
    });
  }

  async inviterStats(guildId: string, inviterId: string): Promise<InviterStats> {
    const [row] = await this.sql<{ total: number; active: number }[]>`
      select count(*)::int as total, count(*) filter (where left_at is null)::int as active
      from (
        select distinct on (user_id) user_id, left_at
        from member_joins
        where guild_id = ${guildId} and inviter_id = ${inviterId} and user_id <> ${inviterId}
        order by user_id, joined_at desc
      ) joins
    `;
    const total = row?.total ?? 0;
    const active = row?.active ?? 0;
    return { total, active, left: total - active };
  }

  async rank(guildId: string, inviterId: string): Promise<{ rank: number; active: number } | null> {
    const [row] = await this.sql<{ rank: number; active: number }[]>`
      select rank, active from (
        select inviter_id,
          count(*) filter (where left_at is null)::int as active,
          rank() over (order by count(*) filter (where left_at is null) desc, count(*) desc)::int as rank
        from (
          select distinct on (user_id) user_id, inviter_id, left_at
          from member_joins
          where guild_id = ${guildId} and inviter_id is not null
          order by user_id, joined_at desc
        ) joins
        where inviter_id <> user_id
        group by inviter_id
      ) ranked
      where inviter_id = ${inviterId}
    `;
    return row ?? null;
  }

  async leaderboard(guildId: string, limit = 10): Promise<LeaderboardRow[]> {
    return this.sql<LeaderboardRow[]>`
      select inviter_id as "inviterId",
        count(*) filter (where left_at is null)::int as active,
        count(*)::int as total
      from (
        select distinct on (user_id) user_id, inviter_id, left_at
        from member_joins
        where guild_id = ${guildId} and inviter_id is not null
        order by user_id, joined_at desc
      ) joins
      where inviter_id <> user_id
      group by inviter_id
      order by active desc, total desc
      limit ${limit}
    `;
  }
}
