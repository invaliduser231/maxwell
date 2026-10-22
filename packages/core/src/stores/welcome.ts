import type { Sql } from '../db/sql.js';

export interface RulesMessage {
  channelId: string;
  messageId: string;
  publishedAt: Date;
}

export class WelcomeStore {
  constructor(private readonly sql: Sql) {}

  async rulesMessage(guildId: string): Promise<RulesMessage | null> {
    const [row] = await this.sql<RulesMessage[]>`
      select channel_id as "channelId", message_id as "messageId", published_at as "publishedAt"
      from welcome_rules where guild_id = ${guildId}
    `;
    return row ?? null;
  }

  async setRulesMessage(guildId: string, channelId: string, messageId: string): Promise<void> {
    await this.sql`
      insert into welcome_rules (guild_id, channel_id, message_id)
      values (${guildId}, ${channelId}, ${messageId})
      on conflict (guild_id) do update
        set channel_id = excluded.channel_id, message_id = excluded.message_id, published_at = now()
    `;
  }

  async clearRulesMessage(guildId: string, messageId?: string): Promise<boolean> {
    const rows = messageId
      ? await this.sql`
          delete from welcome_rules where guild_id = ${guildId} and message_id = ${messageId}
          returning guild_id
        `
      : await this.sql`delete from welcome_rules where guild_id = ${guildId} returning guild_id`;
    return rows.length > 0;
  }

  async accept(guildId: string, userId: string): Promise<boolean> {
    const rows = await this.sql`
      insert into welcome_accepted (guild_id, user_id) values (${guildId}, ${userId})
      on conflict (guild_id, user_id) do nothing
      returning user_id
    `;
    return rows.length > 0;
  }

  async hasAccepted(guildId: string, userId: string): Promise<boolean> {
    const [row] = await this.sql`
      select 1 from welcome_accepted where guild_id = ${guildId} and user_id = ${userId}
    `;
    return row !== undefined;
  }

  async acceptedAt(guildId: string, userId: string): Promise<Date | null> {
    const [row] = await this.sql<{ acceptedAt: Date }[]>`
      select accepted_at as "acceptedAt" from welcome_accepted
      where guild_id = ${guildId} and user_id = ${userId}
    `;
    return row?.acceptedAt ?? null;
  }

  async revoke(guildId: string, userId: string): Promise<void> {
    await this.sql`
      delete from welcome_accepted where guild_id = ${guildId} and user_id = ${userId}
    `;
  }

  async acceptedCount(guildId: string): Promise<number> {
    const [row] = await this.sql<{ count: number }[]>`
      select count(*)::int as count from welcome_accepted where guild_id = ${guildId}
    `;
    return row?.count ?? 0;
  }

  async recent(
    guildId: string,
    since: Date,
  ): Promise<{ joined: number; accepted: number; quickLeaves: number }> {
    const [row] = await this.sql<{ joined: number; accepted: number; quickLeaves: number }[]>`
      select
        (select count(*)::int from member_joins
          where guild_id = ${guildId} and joined_at >= ${since}) as joined,
        (select count(*)::int from welcome_accepted
          where guild_id = ${guildId} and accepted_at >= ${since}) as accepted,
        (select count(*)::int from member_joins
          where guild_id = ${guildId} and joined_at >= ${since}
            and left_at is not null and left_at < joined_at + interval '1 day') as "quickLeaves"
    `;
    return {
      joined: row?.joined ?? 0,
      accepted: row?.accepted ?? 0,
      quickLeaves: row?.quickLeaves ?? 0,
    };
  }

  async forget(guildId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`delete from welcome_rules where guild_id = ${guildId}`;
      await tx`delete from welcome_accepted where guild_id = ${guildId}`;
    });
  }
}
