import { openText, sealText } from '../crypto/data.js';
import type { Sql } from '../db/sql.js';

export interface Afk {
  userId: string;
  reason: string;
  since: Date;
}

export class AfkStore {
  constructor(private readonly sql: Sql) {}

  async set(guildId: string, userId: string, reason: string): Promise<void> {
    await this.sql`
      insert into general_afk (guild_id, user_id, reason)
      values (${guildId}, ${userId}, ${sealText(guildId, reason)})
      on conflict (guild_id, user_id) do update set reason = excluded.reason, since = now()
    `;
  }

  async clear(guildId: string, userId: string): Promise<Afk | null> {
    const [row] = await this.sql<Afk[]>`
      delete from general_afk where guild_id = ${guildId} and user_id = ${userId}
      returning user_id::text as "userId", reason, since
    `;
    return row ? { ...row, reason: openText(guildId, row.reason) } : null;
  }

  async get(guildId: string, userIds: readonly string[]): Promise<Afk[]> {
    if (userIds.length === 0) return [];
    const rows = await this.sql<Afk[]>`
      select user_id::text as "userId", reason, since from general_afk
      where guild_id = ${guildId} and user_id = any(${[...userIds]}::bigint[])
    `;
    return rows.map((row) => ({ ...row, reason: openText(guildId, row.reason) }));
  }

  async users(guildId: string): Promise<string[]> {
    const rows = await this.sql<{ userId: string }[]>`
      select user_id::text as "userId" from general_afk where guild_id = ${guildId}
    `;
    return rows.map((row) => row.userId);
  }
}
