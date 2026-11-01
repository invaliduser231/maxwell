import type { Sql } from './db/sql.js';

export const RETENTION = {
  leftGuildDays: 30,
  closedTicketDays: 365,
  leftMemberDays: 365,
  auditDays: 365,
  closedInboxDays: 365,
  closedDisputeDays: 365,
} as const;

const DAY = 86_400_000;

export interface RetentionResult {
  guilds: number;
  tickets: number;
  joins: number;
  audit: number;
  inbox: number;
  disputes: number;
}

export class RetentionStore {
  constructor(private readonly sql: Sql) {}

  async run(now = Date.now()): Promise<RetentionResult> {
    const before = (days: number) => new Date(now - days * DAY);
    return {
      guilds: await this.purgeLeftGuilds(before(RETENTION.leftGuildDays)),
      tickets: await this.pruneClosedTickets(before(RETENTION.closedTicketDays)),
      joins: await this.pruneLeftMembers(before(RETENTION.leftMemberDays)),
      audit: await this.pruneAudit(before(RETENTION.auditDays)),
      inbox: await this.pruneInbox(before(RETENTION.closedInboxDays)),
      disputes: await this.pruneDisputes(before(RETENTION.closedDisputeDays)),
    };
  }

  async purgeLeftGuilds(before: Date): Promise<number> {
    const left = await this.sql<{ id: string }[]>`
      select id::text as id from guilds where left_at is not null and left_at < ${before}
    `;
    if (left.length === 0) return 0;
    const tables = await this.guildTables();
    let purged = 0;
    for (const { id } of left) {
      const done = await this.sql.begin(async (tx) => {
        const [still] = await tx`
          select 1 from guilds where id = ${id} and left_at is not null and left_at < ${before}
          for update
        `;
        if (!still) return false;
        for (const table of tables) {
          await tx.unsafe(`delete from "${table}" where guild_id = $1`, [id]);
        }
        await tx`delete from guilds where id = ${id}`;
        return true;
      });
      if (done) purged++;
    }
    return purged;
  }

  async pruneClosedTickets(before: Date): Promise<number> {
    const rows = await this.sql`
      delete from tickets_tickets where closed_at is not null and closed_at < ${before}
      returning id
    `;
    return rows.length;
  }

  async pruneLeftMembers(before: Date): Promise<number> {
    const rows = await this.sql`
      delete from member_joins where left_at is not null and left_at < ${before}
      returning id
    `;
    return rows.length;
  }

  async pruneAudit(before: Date): Promise<number> {
    const rows = await this.sql`
      delete from audit_entries where created_at < ${before} returning id
    `;
    return rows.length;
  }

  async pruneInbox(before: Date): Promise<number> {
    const [exists] = await this.sql<{ ok: boolean }[]>`
      select to_regclass('moderation_inbox') is not null as ok
    `;
    if (!exists?.ok) return 0;
    const rows = await this.sql`
      delete from moderation_inbox
      where status in ('resolved', 'dismissed') and resolved_at < ${before}
      returning id
    `;
    return rows.length;
  }

  async pruneDisputes(before: Date): Promise<number> {
    const [exists] = await this.sql<{ ok: boolean }[]>`
      select to_regclass('security_shield_disputes') is not null as ok
    `;
    if (!exists?.ok) return 0;
    const rows = await this.sql`
      delete from security_shield_disputes
      where status <> 'open' and decided_at < ${before}
      returning id
    `;
    return rows.length;
  }

  private async guildTables(): Promise<string[]> {
    const rows = await this.sql<{ table: string }[]>`
      select c.table_name as table
      from information_schema.columns c
      join information_schema.tables t using (table_schema, table_name)
      where c.table_schema = current_schema()
        and c.column_name = 'guild_id'
        and t.table_type = 'BASE TABLE'
      order by c.table_name
    `;
    return rows.map((row) => row.table);
  }
}
