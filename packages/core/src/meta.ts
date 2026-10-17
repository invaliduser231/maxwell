import type { Sql } from './db/sql.js';

export interface CommandInfo {
  name: string;
  aliases: string[];
  module: string;
  description: string;
  subcommands: string[];
}

export async function writeMeta(sql: Sql, key: string, value: unknown): Promise<void> {
  await sql`
    insert into bot_meta (key, value) values (${key}, ${sql.json(value as never)})
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}

export async function readMeta<T>(sql: Sql, key: string): Promise<T | null> {
  const [row] = await sql<{ value: T }[]>`select value from bot_meta where key = ${key}`;
  return row?.value ?? null;
}

export async function builtinCommands(sql: Sql): Promise<CommandInfo[]> {
  return (await readMeta<CommandInfo[]>(sql, 'commands')) ?? [];
}
