import 'server-only';
import { catalog } from '@maxwell/core';
import { InviteStatsStore } from '@maxwell/core/stores/invites';
import { db } from '@/lib/db';

export interface WeekNumbers {
  joins: number;
  joinsBefore: number;
  leaves: number;
  leavesBefore: number;
  messages: number | null;
  messagesBefore: number | null;
  cases: number | null;
  casesBefore: number | null;
  hits: number | null;
  hitsBefore: number | null;
}

export interface Waiting {
  flags: { count: number; oldest: Date | null };
  held: { count: number; oldest: Date | null };
  lockdown: { endsAt: Date | null } | null;
  tickets: { count: number; unclaimed: number; oldest: Date | null };
  forms: { name: string; count: number; newest: Date }[];
  failing: { module: string; count: number; error: string; at: Date }[];
}

async function safe<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

export async function weekNumbers(guildId: string): Promise<WeekNumbers> {
  const { sql } = db();
  const [members, messages, cases, hits] = await Promise.all([
    safe(
      async () => {
        const [row] = await sql<
          { joins: number; joinsBefore: number; leaves: number; leavesBefore: number }[]
        >`
          select
            count(*) filter (where joined_at >= now() - interval '7 days')::int as joins,
            count(*) filter (
              where joined_at >= now() - interval '14 days' and joined_at < now() - interval '7 days'
            )::int as "joinsBefore",
            count(*) filter (where left_at >= now() - interval '7 days')::int as leaves,
            count(*) filter (
              where left_at >= now() - interval '14 days' and left_at < now() - interval '7 days'
            )::int as "leavesBefore"
          from member_joins
          where guild_id = ${guildId}
            and (joined_at >= now() - interval '14 days' or left_at >= now() - interval '14 days')
        `;
        return row ?? { joins: 0, joinsBefore: 0, leaves: 0, leavesBefore: 0 };
      },
      { joins: 0, joinsBefore: 0, leaves: 0, leavesBefore: 0 },
    ),
    safe(async () => {
      const [row] = await sql<{ has: boolean; current: number; previous: number }[]>`
          select
            exists (select 1 from insights_messages where guild_id = ${guildId}) as "has",
            coalesce(sum(messages) filter (where hour >= now() - interval '7 days'), 0)::int as "current",
            coalesce(sum(messages) filter (where hour < now() - interval '7 days'), 0)::int as "previous"
          from insights_messages
          where guild_id = ${guildId} and hour >= now() - interval '14 days'
        `;
      return row?.has ? row : null;
    }, null),
    safe(async () => {
      const [row] = await sql<{ current: number; previous: number }[]>`
          select
            count(*) filter (where created_at >= now() - interval '7 days')::int as "current",
            count(*) filter (where created_at < now() - interval '7 days')::int as "previous"
          from moderation_cases
          where guild_id = ${guildId} and voided_at is null
            and created_at >= now() - interval '14 days'
        `;
      return row ?? null;
    }, null),
    safe(async () => {
      const [row] = await sql<{ current: number; previous: number }[]>`
          select
            count(*) filter (where created_at >= now() - interval '7 days')::int as "current",
            count(*) filter (where created_at < now() - interval '7 days')::int as "previous"
          from automod_hits
          where guild_id = ${guildId} and created_at >= now() - interval '14 days'
        `;
      return row ?? null;
    }, null),
  ]);
  return {
    ...members,
    messages: messages?.current ?? null,
    messagesBefore: messages?.previous ?? null,
    cases: cases?.current ?? null,
    casesBefore: cases?.previous ?? null,
    hits: hits?.current ?? null,
    hitsBefore: hits?.previous ?? null,
  };
}

const moduleKeys = new Set(catalog.map((definition) => definition.key));

export async function waiting(guildId: string): Promise<Waiting> {
  const { sql } = db();
  const [flags, held, lockdown, tickets, forms, failing] = await Promise.all([
    safe(
      async () => {
        const [row] = await sql<{ count: number; oldest: Date | null }[]>`
          select count(*)::int as count, min(created_at) as oldest
          from moderation_cases
          where guild_id = ${guildId} and action = 'flag' and ended_at is null and voided_at is null
        `;
        return row ?? { count: 0, oldest: null };
      },
      { count: 0, oldest: null },
    ),
    safe(
      async () => {
        const [row] = await sql<{ count: number; oldest: Date | null }[]>`
          select count(*)::int as count, min(held_at) as oldest
          from automod_held
          where guild_id = ${guildId} and resolved_at is null
        `;
        return row ?? { count: 0, oldest: null };
      },
      { count: 0, oldest: null },
    ),
    safe(async () => {
      const [row] = await sql<{ endsAt: Date | null }[]>`
          select ends_at as "endsAt" from automod_incidents
          where guild_id = ${guildId} and ended_at is null
            and (ends_at is null or ends_at > now())
          order by started_at desc
          limit 1
        `;
      return row ?? null;
    }, null),
    safe(
      async () => {
        const [row] = await sql<{ count: number; unclaimed: number; oldest: Date | null }[]>`
          select count(*)::int as count,
            count(*) filter (where claimed_by is null)::int as unclaimed,
            min(created_at) as oldest
          from tickets_tickets
          where guild_id = ${guildId} and status = 'open'
        `;
        return row ?? { count: 0, unclaimed: 0, oldest: null };
      },
      { count: 0, unclaimed: 0, oldest: null },
    ),
    safe(
      async () => [
        ...(await sql<{ name: string; count: number; newest: Date }[]>`
        select form_name as name, count(*)::int as count, max(created_at) as newest
        from forms_submissions
        where guild_id = ${guildId} and status = 'pending'
        group by form_name
        order by newest desc
        limit 3
      `),
      ],
      [],
    ),
    safe(
      async () => [
        ...(await sql<{ module: string; count: number; error: string; at: Date }[]>`
        select split_part(kind, '.', 1) as module, count(*)::int as count,
          (array_agg(last_error order by run_at desc))[1] as error,
          max(created_at) as at
        from jobs
        where guild_id = ${guildId} and last_error is not null
        group by split_part(kind, '.', 1)
        order by at desc
        limit 4
      `),
      ],
      [],
    ),
  ]);
  return {
    flags,
    held,
    lockdown,
    tickets,
    forms,
    failing: failing.filter((row) => moduleKeys.has(row.module)),
  };
}

export async function moduleStates(guildId: string): Promise<Map<string, boolean>> {
  const rows = await safe(
    async () => [
      ...(await db().sql<{ module: string; enabled: boolean | null }[]>`
      select module, enabled from guild_modules where guild_id = ${guildId}
    `),
    ],
    [],
  );
  const stored = new Map(rows.map((row) => [row.module, row.enabled]));
  return new Map(
    catalog.map((definition) => [
      definition.key,
      stored.get(definition.key) ?? (definition.defaultEnabled || !definition.toggleable),
    ]),
  );
}

export async function inviteQuality(guildId: string, limit = 5) {
  return safe(() => new InviteStatsStore(db().sql).codes(guildId, limit), []);
}
