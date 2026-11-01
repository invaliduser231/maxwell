import type { Sql } from '../db/sql.js';
import { SHIELD_DAYS, type ShieldSource } from '../modules/security.js';

export interface ShieldReport {
  guildId: string;
  userId: string;
  source: ShieldSource;
  reportedBy: string | null;
  createdAt: Date;
  expiresAt: Date;
}

const columns = (sql: Sql) => sql`
  guild_id::text as "guildId", user_id::text as "userId", source,
  reported_by::text as "reportedBy", created_at as "createdAt", expires_at as "expiresAt"
`;

export const participates = (sql: Sql, guild: ReturnType<Sql>) => sql`
  exists (
    select 1 from guild_modules m
    where m.guild_id = ${guild} and m.module = 'security' and m.enabled is true
      and (m.config -> 'shield' ->> 'enabled') = 'true'
  )
`;

export class ShieldStore {
  constructor(private readonly sql: Sql) {}

  async participates(guildId: string): Promise<boolean> {
    const [row] = await this.sql<{ ok: boolean }[]>`
      select ${participates(this.sql, this.sql`${guildId}::bigint`)} as ok
    `;
    return row?.ok ?? false;
  }

  async report(
    guildId: string,
    userId: string,
    source: ShieldSource,
    reportedBy: string | null,
    now = Date.now(),
  ): Promise<boolean> {
    const expiresAt = new Date(now + SHIELD_DAYS * 86_400_000);
    const rows = await this.sql`
      insert into security_shield_reports (guild_id, user_id, source, reported_by, created_at, expires_at)
      select ${guildId}, ${userId}, ${source}, ${reportedBy}, ${new Date(now)}, ${expiresAt}
      where ${participates(this.sql, this.sql`${guildId}::bigint`)}
      on conflict (guild_id, user_id) do update
        set source = excluded.source, reported_by = excluded.reported_by,
          created_at = excluded.created_at, expires_at = excluded.expires_at
      returning 1
    `;
    return rows.length > 0;
  }

  async withdraw(guildId: string, userId: string): Promise<boolean> {
    const result = await this.sql`
      delete from security_shield_reports where guild_id = ${guildId} and user_id = ${userId}
    `;
    return result.count > 0;
  }

  async elsewhere(userId: string, guildId: string, now = Date.now()): Promise<number> {
    const [row] = await this.sql<{ n: number }[]>`
      select count(*)::int as n from security_shield_reports r
      where r.user_id = ${userId} and r.guild_id <> ${guildId} and r.expires_at > ${new Date(now)}
        and ${participates(this.sql, this.sql`r.guild_id`)}
    `;
    return row?.n ?? 0;
  }

  async get(guildId: string, userId: string): Promise<ShieldReport | null> {
    const [row] = await this.sql<ShieldReport[]>`
      select ${columns(this.sql)} from security_shield_reports
      where guild_id = ${guildId} and user_id = ${userId}
    `;
    return row ?? null;
  }

  async list(guildId: string, limit = 100): Promise<ShieldReport[]> {
    return this.sql<ShieldReport[]>`
      select ${columns(this.sql)} from security_shield_reports
      where guild_id = ${guildId} and expires_at > now()
      order by created_at desc
      limit ${Math.min(Math.max(limit, 1), 500)}
    `;
  }

  async count(guildId: string): Promise<number> {
    const [row] = await this.sql<{ n: number }[]>`
      select count(*)::int as n from security_shield_reports where guild_id = ${guildId} and expires_at > now()
    `;
    return row?.n ?? 0;
  }

  async purge(now = Date.now()): Promise<number> {
    const result = await this
      .sql`delete from security_shield_reports where expires_at <= ${new Date(now)}`;
    return result.count;
  }

  async dropInactive(): Promise<number> {
    const result = await this.sql`
      delete from security_shield_reports r where not ${participates(this.sql, this.sql`r.guild_id`)}
    `;
    return result.count;
  }

  async leave(guildId: string): Promise<number> {
    const result = await this.sql`delete from security_shield_reports where guild_id = ${guildId}`;
    return result.count;
  }
}
