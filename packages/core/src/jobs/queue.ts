import type { Sql } from '../db/sql.js';

export interface JobInput {
  kind: string;
  guildId?: string | null;
  payload?: Record<string, unknown>;
  runAt?: Date;
  dedupeKey?: string;
}

export interface Job {
  id: string;
  kind: string;
  guildId: string | null;
  payload: Record<string, unknown>;
  runAt: Date;
  attempts: number;
}

export async function enqueue(sql: Sql, job: JobInput): Promise<string | null> {
  const [row] = await sql<{ id: string }[]>`
    insert into jobs (kind, guild_id, payload, run_at, dedupe_key)
    values (
      ${job.kind},
      ${job.guildId ?? null},
      ${sql.json((job.payload ?? {}) as never)},
      ${job.runAt ?? new Date()},
      ${job.dedupeKey ?? null}
    )
    on conflict (dedupe_key) do nothing
    returning id
  `;
  return row?.id ?? null;
}

export async function cancel(sql: Sql, dedupeKey: string): Promise<boolean> {
  const rows = await sql`delete from jobs where dedupe_key = ${dedupeKey} returning id`;
  return rows.length > 0;
}

export async function claim(
  sql: Sql,
  limit: number,
  leaseSeconds: number,
  kinds: readonly string[],
): Promise<Job[]> {
  if (kinds.length === 0) return [];
  return sql<Job[]>`
    update jobs set
      locked_until = now() + make_interval(secs => ${leaseSeconds}),
      attempts = attempts + 1,
      dedupe_key = null
    where id in (
      select id from jobs
      where run_at <= now()
        and (locked_until is null or locked_until < now())
        and kind = any(${kinds as string[]}::text[])
      order by run_at
      limit ${limit}
      for update skip locked
    )
    returning id, kind, guild_id as "guildId", payload, run_at as "runAt", attempts
  `;
}

export async function complete(sql: Sql, id: string): Promise<void> {
  await sql`delete from jobs where id = ${id}`;
}

export async function fail(
  sql: Sql,
  id: string,
  error: string,
  retryAt: Date | null,
): Promise<void> {
  if (retryAt === null) {
    await sql`delete from jobs where id = ${id}`;
    return;
  }
  await sql`
    update jobs set locked_until = null, run_at = ${retryAt}, last_error = ${error.slice(0, 2000)}
    where id = ${id}
  `;
}
