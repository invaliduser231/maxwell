import type { Sql } from '../db/sql.js';

export interface SlowmodeHold {
  guildId: string;
  channelId: string;
  original: number;
  applied: number;
  changedAt: Date;
}

export class SlowmodeStore {
  constructor(private readonly sql: Sql) {}

  async all(): Promise<SlowmodeHold[]> {
    return this.sql<SlowmodeHold[]>`
      select guild_id::text as "guildId", channel_id::text as "channelId", original, applied,
        changed_at as "changedAt"
      from automod_slowmode
    `;
  }

  async save(hold: SlowmodeHold): Promise<void> {
    await this.sql`
      insert into automod_slowmode (guild_id, channel_id, original, applied, changed_at)
      values (${hold.guildId}, ${hold.channelId}, ${hold.original}, ${hold.applied}, ${hold.changedAt})
      on conflict (guild_id, channel_id) do update
        set applied = excluded.applied, changed_at = excluded.changed_at
    `;
  }

  async remove(guildId: string, channelId: string): Promise<void> {
    await this.sql`
      delete from automod_slowmode where guild_id = ${guildId} and channel_id = ${channelId}
    `;
  }
}
