import type { Sql } from '../db/sql.js';

export interface MenuMessage {
  guildId: string;
  menuId: string;
  channelId: string;
  messageId: string;
  emojis: string[];
  publishedAt: Date;
}

export interface TemporaryRole {
  guildId: string;
  userId: string;
  roleId: string;
  expiresAt: Date;
}

export interface TimeGrant {
  roleId: string;
  grantedAt: Date;
}

export interface MemberRecord {
  guildId: string;
  userId: string;
  joinedAt: Date | null;
  leftAt: Date | null;
  stickyRoleIds: string[];
}

export interface ActivityCount {
  guildId: string;
  userId: string;
  day: string;
  messages: number;
}

export class RolesStore {
  constructor(private readonly sql: Sql) {}

  async menuMessages(guildId: string): Promise<MenuMessage[]> {
    return this.sql<MenuMessage[]>`
      select guild_id as "guildId", menu_id as "menuId", channel_id as "channelId",
        message_id as "messageId", emojis, published_at as "publishedAt"
      from roles_menu_messages where guild_id = ${guildId}
      order by published_at
    `;
  }

  async menuMessage(guildId: string, menuId: string): Promise<MenuMessage | null> {
    const [row] = await this.sql<MenuMessage[]>`
      select guild_id as "guildId", menu_id as "menuId", channel_id as "channelId",
        message_id as "messageId", emojis, published_at as "publishedAt"
      from roles_menu_messages where guild_id = ${guildId} and menu_id = ${menuId}
    `;
    return row ?? null;
  }

  async menuByMessage(messageId: string): Promise<MenuMessage | null> {
    const [row] = await this.sql<MenuMessage[]>`
      select guild_id as "guildId", menu_id as "menuId", channel_id as "channelId",
        message_id as "messageId", emojis, published_at as "publishedAt"
      from roles_menu_messages where message_id = ${messageId}
    `;
    return row ?? null;
  }

  async saveMenuMessage(
    guildId: string,
    menuId: string,
    channelId: string,
    messageId: string,
    emojis: string[],
  ): Promise<void> {
    await this.sql`
      insert into roles_menu_messages (guild_id, menu_id, channel_id, message_id, emojis)
      values (${guildId}, ${menuId}, ${channelId}, ${messageId}, ${this.sql.array(emojis)})
      on conflict (guild_id, menu_id) do update set
        channel_id = excluded.channel_id,
        message_id = excluded.message_id,
        emojis = excluded.emojis,
        published_at = now()
    `;
  }

  async removeMenuMessage(guildId: string, menuId: string, messageId?: string): Promise<boolean> {
    const rows = messageId
      ? await this.sql`
          delete from roles_menu_messages
          where guild_id = ${guildId} and menu_id = ${menuId} and message_id = ${messageId}
          returning menu_id
        `
      : await this.sql`
          delete from roles_menu_messages where guild_id = ${guildId} and menu_id = ${menuId}
          returning menu_id
        `;
    return rows.length > 0;
  }

  async removeMenuByMessage(messageId: string): Promise<MenuMessage | null> {
    const [row] = await this.sql<MenuMessage[]>`
      delete from roles_menu_messages where message_id = ${messageId}
      returning guild_id as "guildId", menu_id as "menuId", channel_id as "channelId",
        message_id as "messageId", emojis, published_at as "publishedAt"
    `;
    return row ?? null;
  }

  async setTemporary(
    guildId: string,
    userId: string,
    roleId: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.sql`
      insert into roles_temporary (guild_id, user_id, role_id, expires_at)
      values (${guildId}, ${userId}, ${roleId}, ${expiresAt})
      on conflict (guild_id, user_id, role_id) do update set expires_at = excluded.expires_at
    `;
  }

  async temporary(guildId: string, userId: string, roleId: string): Promise<TemporaryRole | null> {
    const [row] = await this.sql<TemporaryRole[]>`
      select guild_id as "guildId", user_id as "userId", role_id as "roleId", expires_at as "expiresAt"
      from roles_temporary
      where guild_id = ${guildId} and user_id = ${userId} and role_id = ${roleId}
    `;
    return row ?? null;
  }

  async temporaryRoles(guildId: string, limit = 100): Promise<TemporaryRole[]> {
    return this.sql<TemporaryRole[]>`
      select guild_id as "guildId", user_id as "userId", role_id as "roleId", expires_at as "expiresAt"
      from roles_temporary where guild_id = ${guildId}
      order by expires_at
      limit ${Math.min(Math.max(limit, 1), 500)}
    `;
  }

  async removeTemporary(guildId: string, userId: string, roleId: string): Promise<boolean> {
    const rows = await this.sql`
      delete from roles_temporary
      where guild_id = ${guildId} and user_id = ${userId} and role_id = ${roleId}
      returning role_id
    `;
    return rows.length > 0;
  }

  async recordJoin(guildId: string, userId: string, joinedAt: Date): Promise<MemberRecord | null> {
    const [before] = await this.sql<MemberRecord[]>`
      select guild_id as "guildId", user_id as "userId", joined_at as "joinedAt", left_at as "leftAt",
        sticky_role_ids as "stickyRoleIds"
      from roles_members where guild_id = ${guildId} and user_id = ${userId}
    `;
    await this.sql.begin(async (tx) => {
      await tx`
        insert into roles_members (guild_id, user_id, joined_at)
        values (${guildId}, ${userId}, ${joinedAt})
        on conflict (guild_id, user_id) do update
          set joined_at = excluded.joined_at, left_at = null, updated_at = now()
      `;
      await tx`delete from roles_time_granted where guild_id = ${guildId} and user_id = ${userId}`;
    });
    return before ?? null;
  }

  async recordSeen(guildId: string, userId: string, joinedAt: Date | null): Promise<void> {
    await this.sql`
      insert into roles_members (guild_id, user_id, joined_at)
      values (${guildId}, ${userId}, ${joinedAt})
      on conflict (guild_id, user_id) do update
        set joined_at = coalesce(roles_members.joined_at, excluded.joined_at), left_at = null
    `;
  }

  async recordLeave(guildId: string, userId: string): Promise<void> {
    await this.sql`
      update roles_members set left_at = now(), updated_at = now()
      where guild_id = ${guildId} and user_id = ${userId}
    `;
  }

  async member(guildId: string, userId: string): Promise<MemberRecord | null> {
    const [row] = await this.sql<MemberRecord[]>`
      select guild_id as "guildId", user_id as "userId", joined_at as "joinedAt", left_at as "leftAt",
        sticky_role_ids as "stickyRoleIds"
      from roles_members where guild_id = ${guildId} and user_id = ${userId}
    `;
    return row ?? null;
  }

  async setSticky(guildId: string, userId: string, roleIds: string[]): Promise<void> {
    await this.sql`
      insert into roles_members (guild_id, user_id, sticky_role_ids)
      values (${guildId}, ${userId}, ${this.sql.array(roleIds)}::bigint[])
      on conflict (guild_id, user_id) do update
        set sticky_role_ids = excluded.sticky_role_ids, updated_at = now()
    `;
  }

  async stickyMembers(guildId: string, limit = 100): Promise<MemberRecord[]> {
    return this.sql<MemberRecord[]>`
      select guild_id as "guildId", user_id as "userId", joined_at as "joinedAt", left_at as "leftAt",
        sticky_role_ids as "stickyRoleIds"
      from roles_members
      where guild_id = ${guildId} and left_at is not null and cardinality(sticky_role_ids) > 0
      order by left_at desc
      limit ${Math.min(Math.max(limit, 1), 500)}
    `;
  }

  async dueForTimeRole(
    guildId: string,
    roleId: string,
    joinedBefore: Date,
    limit = 200,
  ): Promise<string[]> {
    const rows = await this.sql<{ userId: string }[]>`
      select m.user_id as "userId"
      from roles_members m
      where m.guild_id = ${guildId}
        and m.left_at is null
        and m.joined_at is not null
        and m.joined_at <= ${joinedBefore}
        and not exists (
          select 1 from roles_time_granted g
          where g.guild_id = m.guild_id and g.role_id = ${roleId} and g.user_id = m.user_id
        )
      order by m.joined_at
      limit ${limit}
    `;
    return rows.map((row) => row.userId);
  }

  async markTimeGranted(guildId: string, userId: string, roleId: string): Promise<void> {
    await this.sql`
      insert into roles_time_granted (guild_id, user_id, role_id)
      values (${guildId}, ${userId}, ${roleId})
      on conflict do nothing
    `;
  }

  async timeGrantedCount(guildId: string, roleId: string): Promise<number> {
    const [row] = await this.sql<{ count: number }[]>`
      select count(*)::int as count from roles_time_granted
      where guild_id = ${guildId} and role_id = ${roleId}
    `;
    return row?.count ?? 0;
  }

  async pruneLeft(guildId: string, leftBefore: Date): Promise<number> {
    const rows = await this.sql`
      delete from roles_members
      where guild_id = ${guildId} and left_at is not null and left_at < ${leftBefore}
      returning user_id
    `;
    return rows.length;
  }

  async configuredGuilds(): Promise<string[]> {
    const rows = await this.sql<{ guildId: string }[]>`
      select guild_id as "guildId" from guild_modules where module = 'roles'
    `;
    return rows.map((row) => row.guildId);
  }

  async temporaryFor(guildId: string, userId: string): Promise<TemporaryRole[]> {
    return this.sql<TemporaryRole[]>`
      select guild_id as "guildId", user_id as "userId", role_id as "roleId", expires_at as "expiresAt"
      from roles_temporary where guild_id = ${guildId} and user_id = ${userId}
      order by expires_at
    `;
  }

  async timeGranted(guildId: string, userId: string): Promise<TimeGrant[]> {
    return this.sql<TimeGrant[]>`
      select role_id as "roleId", granted_at as "grantedAt"
      from roles_time_granted where guild_id = ${guildId} and user_id = ${userId}
      order by granted_at
    `;
  }

  async forgetMember(guildId: string, userId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`delete from roles_members where guild_id = ${guildId} and user_id = ${userId}`;
      await tx`delete from roles_time_granted where guild_id = ${guildId} and user_id = ${userId}`;
      await tx`delete from roles_activity where guild_id = ${guildId} and user_id = ${userId}`;
      await tx`
        delete from roles_activity_granted where guild_id = ${guildId} and user_id = ${userId}
      `;
    });
  }

  async addActivity(rows: readonly ActivityCount[]): Promise<number> {
    if (rows.length === 0) return 0;
    const items = rows.map((row) => ({
      guild_id: row.guildId,
      user_id: row.userId,
      day: row.day,
      messages: row.messages,
    }));
    const written = await this.sql`
      insert into roles_activity (guild_id, user_id, day, messages)
      select x.guild_id, x.user_id, x.day, x.messages
      from jsonb_to_recordset(${this.sql.json(items as never)})
        as x(guild_id bigint, user_id bigint, day date, messages integer)
      on conflict (guild_id, user_id, day)
        do update set messages = roles_activity.messages + excluded.messages
      returning 1
    `;
    return written.length;
  }

  async activeMembers(
    guildId: string,
    since: string,
    minMessages: number,
    limit = 50_000,
  ): Promise<string[]> {
    const rows = await this.sql<{ userId: string }[]>`
      select user_id as "userId" from roles_activity
      where guild_id = ${guildId} and day >= ${since}::date
      group by user_id
      having sum(messages) >= ${minMessages}
      order by user_id
      limit ${limit}
    `;
    return rows.map((row) => String(row.userId));
  }

  async activityGranted(guildId: string, roleId: string): Promise<string[]> {
    const rows = await this.sql<{ userId: string }[]>`
      select user_id as "userId" from roles_activity_granted
      where guild_id = ${guildId} and role_id = ${roleId}
      order by user_id
    `;
    return rows.map((row) => String(row.userId));
  }

  async markActivityGranted(guildId: string, roleId: string, userId: string): Promise<void> {
    await this.sql`
      insert into roles_activity_granted (guild_id, role_id, user_id)
      values (${guildId}, ${roleId}, ${userId})
      on conflict do nothing
    `;
  }

  async dropActivityGrant(guildId: string, roleId: string, userId: string): Promise<void> {
    await this.sql`
      delete from roles_activity_granted
      where guild_id = ${guildId} and role_id = ${roleId} and user_id = ${userId}
    `;
  }

  async keepActivityRoles(guildId: string, roleIds: readonly string[]): Promise<number> {
    const rows = await this.sql`
      delete from roles_activity_granted
      where guild_id = ${guildId} and not (role_id = any(${[...roleIds]}::bigint[]))
      returning 1
    `;
    return rows.length;
  }

  async pruneActivity(guildId: string, before: string): Promise<number> {
    const rows = await this.sql`
      delete from roles_activity where guild_id = ${guildId} and day < ${before}::date
      returning 1
    `;
    return rows.length;
  }

  async activityFor(
    guildId: string,
    userId: string,
  ): Promise<{ days: { day: string; messages: number }[]; roleIds: string[] }> {
    const [days, grants] = await Promise.all([
      this.sql<{ day: string; messages: number }[]>`
        select to_char(day, 'YYYY-MM-DD') as day, messages from roles_activity
        where guild_id = ${guildId} and user_id = ${userId}
        order by day
      `,
      this.sql<{ roleId: string }[]>`
        select role_id as "roleId" from roles_activity_granted
        where guild_id = ${guildId} and user_id = ${userId}
        order by role_id
      `,
    ]);
    return { days: [...days], roleIds: grants.map((row) => String(row.roleId)) };
  }

  async wakeJobs(prefix: string, at: Date): Promise<number> {
    const rows = await this.sql`
      update jobs set run_at = ${at}
      where (dedupe_key = ${prefix} or dedupe_key like ${`${prefix}:%`})
        and run_at > ${at}
        and (locked_until is null or locked_until < now())
      returning id
    `;
    return rows.length;
  }
}
