import type { Sql } from '../db/sql.js';
import type { Logger } from '../log.js';
import { type DataCipher, dataCipher, isSealed } from './data.js';

export type SealKind = 'text' | 'json' | 'samples' | 'name';

export interface SealColumn {
  name: string;
  kind: SealKind;
}

export interface SealKey {
  name: string;
  type: 'bigint' | 'timestamptz';
}

export interface SealTarget {
  table: string;
  key: SealKey[];
  guild: string;
  columns: SealColumn[];
}

export interface SealRow {
  key: string[];
  guildId: string;
  values: Record<string, unknown>;
}

export interface SealSource {
  next(target: SealTarget, after: string[] | null, limit: number): Promise<SealRow[]>;
  write(target: SealTarget, row: SealRow, values: Record<string, unknown>): Promise<boolean>;
}

export interface SealOptions {
  batchSize?: number;
  pauseMs?: number;
  signal?: AbortSignal;
  cipher?: DataCipher;
  log?: Logger;
}

export interface SealProgress {
  table: string;
  scanned: number;
  sealed: number;
  batches: number;
}

export const sealTargets: SealTarget[] = [
  {
    table: 'moderation_cases',
    key: [
      { name: 'guild_id', type: 'bigint' },
      { name: 'number', type: 'bigint' },
    ],
    guild: 'guild_id',
    columns: [
      { name: 'reason', kind: 'text' },
      { name: 'void_reason', kind: 'text' },
      { name: 'excerpt', kind: 'text' },
    ],
  },
  {
    table: 'moderation_notes',
    key: [{ name: 'id', type: 'bigint' }],
    guild: 'guild_id',
    columns: [{ name: 'body', kind: 'text' }],
  },
  {
    table: 'moderation_names',
    key: [{ name: 'id', type: 'bigint' }],
    guild: 'guild_id',
    columns: [
      { name: 'value', kind: 'text' },
      { name: 'previous', kind: 'text' },
    ],
  },
  {
    table: 'moderation_inbox',
    key: [{ name: 'id', type: 'bigint' }],
    guild: 'guild_id',
    columns: [
      { name: 'excerpt', kind: 'text' },
      { name: 'body', kind: 'text' },
      { name: 'note', kind: 'text' },
    ],
  },
  {
    table: 'tickets_tickets',
    key: [{ name: 'id', type: 'bigint' }],
    guild: 'guild_id',
    columns: [
      { name: 'subject', kind: 'text' },
      { name: 'close_reason', kind: 'text' },
    ],
  },
  {
    table: 'tickets_messages',
    key: [
      { name: 'ticket_id', type: 'bigint' },
      { name: 'message_id', type: 'bigint' },
    ],
    guild: '(select t.guild_id from tickets_tickets t where t.id = tickets_messages.ticket_id)',
    columns: [
      { name: 'content', kind: 'text' },
      { name: 'attachments', kind: 'json' },
      { name: 'embeds', kind: 'json' },
    ],
  },
  {
    table: 'automod_hits',
    key: [{ name: 'id', type: 'bigint' }],
    guild: 'guild_id',
    columns: [
      { name: 'detail', kind: 'text' },
      { name: 'content', kind: 'text' },
    ],
  },
  {
    table: 'automod_messages',
    key: [
      { name: 'guild_id', type: 'bigint' },
      { name: 'message_id', type: 'bigint' },
      { name: 'created_at', type: 'timestamptz' },
    ],
    guild: 'guild_id',
    columns: [{ name: 'content', kind: 'text' }],
  },
  {
    table: 'automod_dryruns',
    key: [{ name: 'id', type: 'bigint' }],
    guild: 'guild_id',
    columns: [{ name: 'samples', kind: 'samples' }],
  },
  {
    table: 'starboard_posts',
    key: [{ name: 'message_id', type: 'bigint' }],
    guild: 'guild_id',
    columns: [{ name: 'content', kind: 'text' }],
  },
  {
    table: 'security_incident_events',
    key: [{ name: 'id', type: 'bigint' }],
    guild: 'guild_id',
    columns: [{ name: 'detail', kind: 'name' }],
  },
  {
    table: 'forms_sessions',
    key: [{ name: 'id', type: 'bigint' }],
    guild: 'guild_id',
    columns: [{ name: 'answers', kind: 'json' }],
  },
  {
    table: 'forms_submissions',
    key: [{ name: 'id', type: 'bigint' }],
    guild: 'guild_id',
    columns: [
      { name: 'answers', kind: 'json' },
      { name: 'note', kind: 'text' },
    ],
  },
];

const SEALED_PATTERN = '^enc:v1:[A-Za-z0-9+/]+={0,2}$';

function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function pending(column: SealColumn): string {
  const col = quote(column.name);
  switch (column.kind) {
    case 'text':
      return `(${col} is not null and ${col} !~ '${SEALED_PATTERN}')`;
    case 'json':
      return `(${col} is not null and jsonb_typeof(${col}) <> 'string')`;
    case 'samples':
      return `(jsonb_typeof(${col}) = 'array' and exists (
        select 1 from jsonb_array_elements(${col}) s
        where (jsonb_typeof(s.value -> 'content') = 'string' and s.value ->> 'content' !~ '${SEALED_PATTERN}')
          or (jsonb_typeof(s.value -> 'detail') = 'string' and s.value ->> 'detail' !~ '${SEALED_PATTERN}')
      ))`;
    case 'name':
      return `(jsonb_typeof(${col} -> 'name') = 'string' and ${col} ->> 'name' !~ '${SEALED_PATTERN}')`;
  }
}

function sealField(cipher: DataCipher, guildId: string, value: unknown): unknown {
  return typeof value === 'string' ? cipher.encrypt(guildId, value) : value;
}

export function sealValue(
  cipher: DataCipher,
  guildId: string,
  kind: SealKind,
  value: unknown,
): unknown {
  if (value === null || value === undefined) return value;
  switch (kind) {
    case 'text':
      return sealField(cipher, guildId, value);
    case 'json':
      return isSealed(value) ? value : cipher.encrypt(guildId, JSON.stringify(value));
    case 'samples':
      return Array.isArray(value)
        ? value.map((sample) =>
            sample && typeof sample === 'object'
              ? {
                  ...sample,
                  content: sealField(cipher, guildId, (sample as { content?: unknown }).content),
                  detail: sealField(cipher, guildId, (sample as { detail?: unknown }).detail),
                }
              : sample,
          )
        : value;
    case 'name':
      return value && typeof value === 'object' && !Array.isArray(value)
        ? {
            ...value,
            name: sealField(cipher, guildId, (value as { name?: unknown }).name),
          }
        : value;
  }
}

export function sealRow(
  cipher: DataCipher,
  target: SealTarget,
  row: SealRow,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const column of target.columns) {
    const before = row.values[column.name];
    const after = sealValue(cipher, row.guildId, column.kind, before);
    if (JSON.stringify(after) !== JSON.stringify(before)) values[column.name] = after;
  }
  return values;
}

export function pgSealSource(sql: Sql): SealSource {
  return {
    async next(target, after, limit) {
      const keys = target.key.map((key) => quote(key.name));
      const params: (string | number)[] = [];
      let cursor = '';
      if (after) {
        const placeholders = target.key.map((key, index) => {
          params.push(after[index] as string);
          return `$${params.length}::${key.type}`;
        });
        cursor = `and (${keys.join(', ')}) > (${placeholders.join(', ')})`;
      }
      params.push(limit);
      const rows = await sql.unsafe<Record<string, unknown>[]>(
        `select ${keys.map((key, index) => `${key}::text as "k${index}"`).join(', ')},
          (${target.guild})::text as "guildId",
          ${target.columns.map((column) => quote(column.name)).join(', ')}
        from ${quote(target.table)}
        where (${target.columns.map(pending).join(' or ')}) ${cursor}
        order by ${keys.join(', ')}
        limit $${params.length}`,
        params,
      );
      return rows.map((row) => ({
        key: target.key.map((_, index) => String(row[`k${index}`])),
        guildId: String(row.guildId),
        values: Object.fromEntries(target.columns.map((column) => [column.name, row[column.name]])),
      }));
    },
    async write(target, row, values) {
      const params: unknown[] = [];
      const push = (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
      };
      const kinds = new Map(target.columns.map((column) => [column.name, column.kind]));
      const encode = (name: string, value: unknown) =>
        kinds.get(name) === 'text'
          ? `${push(value)}::text`
          : `${push(value === null ? null : JSON.stringify(value))}::jsonb`;
      const sets = Object.entries(values).map(
        ([name, value]) => `${quote(name)} = ${encode(name, value)}`,
      );
      if (sets.length === 0) return false;
      const keys = target.key.map(
        (key, index) => `${quote(key.name)} = ${push(row.key[index])}::${key.type}`,
      );
      const guards = Object.keys(values).map(
        (name) => `${quote(name)} is not distinct from ${encode(name, row.values[name])}`,
      );
      const result = await sql.unsafe(
        `update ${quote(target.table)} set ${sets.join(', ')}
        where ${[...keys, ...guards].join(' and ')}`,
        params as never[],
      );
      return result.count > 0;
    },
  };
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

export async function sealTable(
  source: SealSource,
  target: SealTarget,
  options: SealOptions = {},
): Promise<SealProgress> {
  const cipher = options.cipher ?? dataCipher();
  const progress: SealProgress = { table: target.table, scanned: 0, sealed: 0, batches: 0 };
  if (!cipher.enabled) return progress;
  const size = Math.max(options.batchSize ?? 200, 1);
  let after: string[] | null = null;
  while (!options.signal?.aborted) {
    const rows = await source.next(target, after, size);
    if (rows.length === 0) break;
    progress.batches++;
    for (const row of rows) {
      progress.scanned++;
      const values = sealRow(cipher, target, row);
      if (Object.keys(values).length > 0 && (await source.write(target, row, values))) {
        progress.sealed++;
      }
    }
    after = rows[rows.length - 1]?.key ?? null;
    if (rows.length < size) break;
    await pause(options.pauseMs ?? 0, options.signal);
  }
  return progress;
}

export async function existingTables(sql: Sql, targets: SealTarget[]): Promise<SealTarget[]> {
  const rows = await sql<{ table: string }[]>`
    select c.relname as table
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = current_schema() and c.relkind in ('r', 'p')
      and c.relname = any(${targets.map((target) => target.table)}::text[])
  `;
  const present = new Set(rows.map((row) => row.table));
  return targets.filter((target) => present.has(target.table));
}

export async function sealExisting(
  sql: Sql,
  options: SealOptions & { targets?: SealTarget[] } = {},
): Promise<SealProgress[]> {
  const cipher = options.cipher ?? dataCipher();
  if (!cipher.enabled) return [];
  const source = pgSealSource(sql);
  const results: SealProgress[] = [];
  for (const target of await existingTables(sql, options.targets ?? sealTargets)) {
    if (options.signal?.aborted) break;
    const progress = await sealTable(source, target, { ...options, cipher });
    results.push(progress);
    if (progress.sealed > 0) {
      options.log?.info(
        { table: progress.table, sealed: progress.sealed, scanned: progress.scanned },
        'encrypted stored text',
      );
    }
  }
  return results;
}
