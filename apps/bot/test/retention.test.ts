import { connect, migrate, RetentionStore, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/tickets';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('RetentionStore', () => {
  let sql: Sql;
  let store: RetentionStore;
  const base = BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));
  const gone = String(base);
  const recent = String(base + 1n);
  const active = String(base + 2n);
  const old = new Date('2000-01-01T00:00:00Z');
  const user = '330000000000000001';

  async function ticket(guildId: string, number: number, closedAt: Date | null): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      insert into tickets_tickets (guild_id, number, panel_id, kind, source, opener_id, status, closed_at)
      values (${guildId}, ${number}, 'support', 'support', 'panel', ${user},
        ${closedAt ? 'closed' : 'open'}, ${closedAt})
      returning id::text as id
    `;
    const id = row?.id ?? '';
    await sql`
      insert into tickets_messages (ticket_id, message_id, author_id, author_name, content, created_at)
      values (${id}, ${String(base + BigInt(number))}, ${user}, 'lena', 'hello', now())
    `;
    return id;
  }

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'tickets', migrations: definition.migrations },
    ]);
    store = new RetentionStore(sql);
    await sql`
      insert into guilds (id, left_at) values (${gone}, ${old}), (${recent}, now()), (${active}, null)
    `;
    for (const guildId of [gone, recent, active]) {
      await sql`insert into guild_modules (guild_id, module, enabled) values (${guildId}, 'levels', true)`;
      await sql`
        insert into audit_entries (guild_id, module, action, summary, created_at)
        values (${guildId}, 'levels', 'test', 'old', ${old}), (${guildId}, 'levels', 'test', 'new', now())
      `;
      await sql`
        insert into member_joins (guild_id, user_id, joined_at, left_at)
        values (${guildId}, ${user}, ${old}, ${old}), (${guildId}, ${user}, now(), null)
      `;
    }
    await ticket(gone, 1, null);
    await ticket(active, 1, old);
    await ticket(active, 2, null);
    await ticket(active, 3, new Date());
  });

  afterAll(async () => {
    for (const guildId of [gone, recent, active]) {
      await sql`delete from tickets_tickets where guild_id = ${guildId}`;
      await sql`delete from audit_entries where guild_id = ${guildId}`;
      await sql`delete from member_joins where guild_id = ${guildId}`;
      await sql`delete from guilds where id = ${guildId}`;
    }
    await sql.end();
  });

  it('removes everything of a community that Maxwell left long ago', async () => {
    const purged = await store.purgeLeftGuilds(new Date('2001-01-01T00:00:00Z'));
    expect(purged).toBeGreaterThanOrEqual(1);
    const counts = await sql<{ n: number }[]>`
      select (select count(*) from guilds where id = ${gone})::int
        + (select count(*) from guild_modules where guild_id = ${gone})::int
        + (select count(*) from audit_entries where guild_id = ${gone})::int
        + (select count(*) from member_joins where guild_id = ${gone})::int
        + (select count(*) from tickets_tickets where guild_id = ${gone})::int as n
    `;
    expect(counts[0]?.n).toBe(0);
    const [kept] = await sql<{ n: number }[]>`
      select count(*)::int as n from guilds where id in (${recent}, ${active})
    `;
    expect(kept?.n).toBe(2);
  });

  it('skips a community that came back before the purge', async () => {
    await sql`update guilds set left_at = ${old} where id = ${recent}`;
    await sql`update guilds set left_at = null where id = ${recent}`;
    await store.purgeLeftGuilds(new Date('2001-01-01T00:00:00Z'));
    const [row] = await sql`select 1 from guilds where id = ${recent}`;
    expect(row).toBeDefined();
  });

  it('prunes old closed tickets, old leaves and old audit entries only', async () => {
    const cutoff = new Date('2001-01-01T00:00:00Z');
    expect(await store.pruneClosedTickets(cutoff)).toBeGreaterThanOrEqual(1);
    expect(await store.pruneLeftMembers(cutoff)).toBeGreaterThanOrEqual(2);
    expect(await store.pruneAudit(cutoff)).toBeGreaterThanOrEqual(2);

    const tickets = await sql<{ number: number }[]>`
      select number from tickets_tickets where guild_id = ${active} order by number
    `;
    expect(tickets.map((row) => row.number)).toEqual([2, 3]);
    const [messages] = await sql<{ n: number }[]>`
      select count(*)::int as n from tickets_messages m
      join tickets_tickets t on t.id = m.ticket_id where t.guild_id = ${active}
    `;
    expect(messages?.n).toBe(2);
    const [joins] = await sql<{ n: number }[]>`
      select count(*)::int as n from member_joins where guild_id in (${recent}, ${active})
    `;
    expect(joins?.n).toBe(2);
    const audit = await sql<{ summary: string }[]>`
      select summary from audit_entries where guild_id in (${recent}, ${active})
    `;
    expect(audit.map((row) => row.summary)).toEqual(['new', 'new']);
  });
});
