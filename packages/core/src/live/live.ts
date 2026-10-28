import type { Sql } from '../db/sql.js';

export const LIVE_CHANNEL = 'maxwell_live';

export interface LiveTable {
  table: string;
  module: string;
  parent?: { table: string; column: string };
}

export const liveTables: LiveTable[] = [
  { table: 'audit_entries', module: 'audit' },
  { table: 'automod_held', module: 'automod' },
  { table: 'automod_incidents', module: 'automod' },
  { table: 'backups_imports', module: 'backups' },
  { table: 'backups_snapshots', module: 'backups' },
  { table: 'collection_cards', module: 'collection' },
  { table: 'collection_drops', module: 'collection' },
  { table: 'collection_trades', module: 'collection' },
  { table: 'economy_purchases', module: 'economy' },
  { table: 'economy_resets', module: 'economy' },
  { table: 'economy_stock', module: 'economy' },
  { table: 'events_events', module: 'events' },
  { table: 'events_poll_votes', module: 'events' },
  { table: 'events_polls', module: 'events' },
  { table: 'events_rsvps', module: 'events' },
  { table: 'feeds_posts', module: 'feeds' },
  { table: 'forms_submissions', module: 'forms' },
  {
    table: 'forms_votes',
    module: 'forms',
    parent: { table: 'forms_submissions', column: 'submission_id' },
  },
  { table: 'giveaways_items', module: 'giveaways' },
  {
    table: 'giveaways_entries',
    module: 'giveaways',
    parent: { table: 'giveaways_items', column: 'giveaway_id' },
  },
  {
    table: 'giveaways_winners',
    module: 'giveaways',
    parent: { table: 'giveaways_items', column: 'giveaway_id' },
  },
  { table: 'member_joins', module: 'invites' },
  { table: 'moderation_cases', module: 'moderation' },
  { table: 'moderation_inbox', module: 'moderation' },
  { table: 'moderation_locks', module: 'moderation' },
  { table: 'moderation_notes', module: 'moderation' },
  { table: 'roles_menu_messages', module: 'roles' },
  { table: 'roles_temporary', module: 'roles' },
  { table: 'scheduler_reminders', module: 'scheduler' },
  { table: 'security_checks', module: 'security' },
  { table: 'security_events', module: 'security' },
  { table: 'security_raids', module: 'security' },
  { table: 'starboard_posts', module: 'starboard' },
  { table: 'suggestions_items', module: 'suggestions' },
  {
    table: 'suggestions_votes',
    module: 'suggestions',
    parent: { table: 'suggestions_items', column: 'suggestion_id' },
  },
  {
    table: 'tickets_messages',
    module: 'tickets',
    parent: { table: 'tickets_tickets', column: 'ticket_id' },
  },
  { table: 'tickets_panels', module: 'tickets' },
  { table: 'tickets_tickets', module: 'tickets' },
  { table: 'voice_rooms', module: 'voice' },
];

const FUNCTION = `
  create or replace function maxwell_live_notify() returns trigger language plpgsql as $$
  declare
    rec jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
    guild text;
  begin
    if tg_nargs > 1 then
      execute format('select guild_id::text from %I where id = $1', tg_argv[1])
        into guild using (rec ->> tg_argv[2])::bigint;
    else
      guild := rec ->> 'guild_id';
    end if;
    if guild is not null then
      perform pg_notify('${LIVE_CHANNEL}', guild || ':' || tg_argv[0]);
    end if;
    return null;
  end
  $$
`;

export async function installLive(sql: Sql, tables: LiveTable[] = liveTables): Promise<void> {
  await sql.unsafe(FUNCTION);
  const present = await sql<{ table: string; armed: boolean }[]>`
    select c.relname as table,
      exists (
        select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'maxwell_live'
      ) as armed
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = current_schema() and c.relkind = 'r'
      and c.relname = any(${tables.map((entry) => entry.table)}::text[])
  `;
  const state = new Map(present.map((row) => [row.table, row.armed]));
  for (const entry of tables) {
    if (state.get(entry.table) !== false) continue;
    const args = [entry.module, ...(entry.parent ? [entry.parent.table, entry.parent.column] : [])]
      .map((arg) => `'${arg.replace(/'/g, "''")}'`)
      .join(', ');
    await sql.unsafe(
      `create trigger maxwell_live after insert or update or delete on "${entry.table}"
       for each row execute function maxwell_live_notify(${args})`,
    );
  }
}

export function parseLive(payload: string): { guildId: string; module: string } | null {
  const index = payload.indexOf(':');
  if (index <= 0) return null;
  const guildId = payload.slice(0, index);
  const module = payload.slice(index + 1);
  if (!/^\d{1,21}$/.test(guildId) || !module) return null;
  return { guildId, module };
}
