import type postgres from 'postgres';
import { dataCipher, openText, sealText } from '../crypto/data.js';
import type { Sql } from '../db/sql.js';

export interface Actor {
  id: string | null;
}

export const maxwell: Actor = { id: null };

export interface UndoSpec {
  kind: string;
  payload: Record<string, unknown>;
}

export interface AuditInput {
  guildId: string;
  actor: Actor;
  module: string;
  action: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  undo?: UndoSpec | null;
}

export interface AuditEntry {
  id: string;
  guildId: string;
  actorId: string | null;
  module: string;
  action: string;
  summary: string;
  before: unknown;
  after: unknown;
  undo: UndoSpec | null;
  createdAt: Date;
  undoneAt: Date | null;
  undoneBy: string | null;
}

export type AuditKind = 'settings' | 'mod' | 'auto';

export interface AuditFilter {
  module?: string;
  modules?: readonly string[];
  before?: string;
  limit?: number;
  actor?: string | null;
  since?: Date;
  until?: Date;
  action?: string;
  kind?: AuditKind;
  search?: string;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SEARCH_PAGE = 200;
const SEALED_PATTERN = '^enc:v1:[A-Za-z0-9+/]+={0,2}$';

type SearchRow = AuditEntry & { sealed?: boolean | null };

function searchPattern(term: string): string {
  return `%${escapeLike(term.slice(0, 100))}%`;
}

function sealsReason(module: string, action: string): boolean {
  return module === 'moderation' && action.startsWith('case.');
}

function withReason(value: unknown, change: (text: string) => string): unknown {
  if (!isRecord(value) || typeof value.reason !== 'string') return value;
  return { ...value, reason: change(value.reason) };
}

function withUndoReason(undo: UndoSpec, change: (text: string) => string): UndoSpec {
  if (!isRecord(undo.payload) || typeof undo.payload.reason !== 'string') return undo;
  return { ...undo, payload: { ...undo.payload, reason: change(undo.payload.reason) } };
}

export function sealAudit(input: AuditInput): AuditInput {
  if (!sealsReason(input.module, input.action)) return input;
  const seal = (text: string) => sealText(input.guildId, text);
  return {
    ...input,
    before: withReason(input.before, seal),
    after: withReason(input.after, seal),
    undo: input.undo ? withUndoReason(input.undo, seal) : input.undo,
  };
}

export function openAudit(entry: AuditEntry): AuditEntry {
  if (!sealsReason(entry.module, entry.action)) return entry;
  const open = (text: string) => openText(String(entry.guildId), text);
  return {
    ...entry,
    before: withReason(entry.before, open),
    after: withReason(entry.after, open),
    undo: entry.undo ? withUndoReason(entry.undo, open) : entry.undo,
  };
}

export const UNDO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function canUndo(entry: AuditEntry, now = Date.now()): boolean {
  return (
    entry.undo !== null &&
    entry.undoneAt === null &&
    now - entry.createdAt.getTime() < UNDO_WINDOW_MS
  );
}

export class AuditStore {
  constructor(private readonly sql: Sql) {}

  async record(input: AuditInput): Promise<string> {
    const sealed = sealAudit(input);
    const [row] = await this.sql<{ id: string }[]>`
      insert into audit_entries (guild_id, actor_id, module, action, summary, before, after, undo)
      values (
        ${input.guildId},
        ${input.actor.id},
        ${input.module},
        ${input.action},
        ${input.summary},
        ${sealed.before === undefined ? null : this.sql.json(sealed.before as never)},
        ${sealed.after === undefined ? null : this.sql.json(sealed.after as never)},
        ${sealed.undo ? this.sql.json(sealed.undo as never) : null}
      )
      returning id
    `;
    return row?.id ?? '';
  }

  async merge(input: AuditInput, windowMs: number): Promise<string | null> {
    const [last] = await this.sql<
      {
        id: string;
        actorId: string | null;
        action: string;
        before: unknown;
        after: unknown;
        fresh: boolean;
      }[]
    >`
      select id, actor_id as "actorId", action, before, after,
        undone_at is null and created_at > now() - make_interval(secs => ${windowMs / 1000}) as fresh
      from audit_entries
      where guild_id = ${input.guildId} and module = ${input.module}
      order by id desc
      limit 1
    `;
    if (
      !last?.fresh ||
      last.action !== input.action ||
      last.actorId !== input.actor.id ||
      !isRecord(last.before) ||
      !isRecord(last.after) ||
      !isRecord(input.before) ||
      !isRecord(input.after)
    ) {
      return this.record(input);
    }
    const before = { ...input.before, ...last.before };
    const after = { ...last.after, ...input.after };
    for (const key of Object.keys(after)) {
      if (JSON.stringify(before[key] ?? null) === JSON.stringify(after[key] ?? null)) {
        delete before[key];
        delete after[key];
      }
    }
    if (Object.keys(after).length === 0) {
      await this
        .sql`delete from audit_entries where guild_id = ${input.guildId} and id = ${last.id}`;
      return null;
    }
    await this.sql`
      update audit_entries
      set summary = ${input.summary},
        before = ${this.sql.json(before as never)},
        after = ${this.sql.json(after as never)},
        created_at = now()
      where guild_id = ${input.guildId} and id = ${last.id}
    `;
    return last.id;
  }

  async get(guildId: string, id: string): Promise<AuditEntry | null> {
    const [row] = await this.sql<AuditEntry[]>`
      select id, guild_id as "guildId", actor_id as "actorId", module, action, summary, before, after, undo,
        created_at as "createdAt", undone_at as "undoneAt", undone_by as "undoneBy"
      from audit_entries where guild_id = ${guildId} and id = ${id}
    `;
    return row ? openAudit(row) : null;
  }

  async list(guildId: string, options: AuditFilter = {}): Promise<AuditEntry[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const term = options.search?.trim();
    if (term && dataCipher().enabled) return this.#searchOpened(guildId, options, term, limit);
    const rows = await this.#select(
      guildId,
      options,
      limit,
      this.#search(options.search),
      this.sql``,
    );
    return rows.map(openAudit);
  }

  async #searchOpened(
    guildId: string,
    options: AuditFilter,
    term: string,
    limit: number,
  ): Promise<AuditEntry[]> {
    const pattern = searchPattern(term);
    const candidates = this.#select(
      guildId,
      options,
      null,
      this.sql`and (${this.#matches(pattern)} or ${this.#sealedReason()})`,
      this.sql`, ${this.#sealedReason()} as sealed`,
    );
    return this.sql.begin(async (tx) => {
      await tx`declare audit_search no scroll cursor for ${candidates}`;
      const found: AuditEntry[] = [];
      while (found.length < limit) {
        const page = await tx.unsafe<SearchRow[]>(`fetch ${SEARCH_PAGE} from audit_search`);
        const entries = page.map(({ sealed, ...entry }) => ({
          entry: openAudit(entry),
          sealed: sealed === true,
        }));
        const opened = await this.#matchOpened(
          tx,
          entries.filter((item) => item.sealed).map((item) => item.entry),
          pattern,
        );
        for (const { entry, sealed } of entries) {
          if (!sealed || opened.has(String(entry.id))) found.push(entry);
        }
        if (page.length < SEARCH_PAGE) break;
      }
      return found.slice(0, limit);
    });
  }

  async #matchOpened(
    sql: postgres.TransactionSql,
    entries: AuditEntry[],
    pattern: string,
  ): Promise<Set<string>> {
    if (entries.length === 0) return new Set();
    const rows = JSON.stringify(
      entries.map((entry) => ({
        id: String(entry.id),
        summary: entry.summary,
        before: entry.before,
        after: entry.after,
      })),
      (_key, value) => (typeof value === 'string' ? value.replaceAll('\u0000', '') : value),
    );
    const found = await sql<{ id: string }[]>`
      select id
      from jsonb_to_recordset(${rows}::text::jsonb)
        as x(id text, summary text, before jsonb, after jsonb)
      where ${this.#matches(pattern)}
    `;
    return new Set(found.map((row) => row.id));
  }

  #select(
    guildId: string,
    options: AuditFilter,
    limit: number | null,
    search: postgres.Fragment,
    extra: postgres.Fragment,
  ) {
    return this.sql<SearchRow[]>`
      select id, guild_id as "guildId", actor_id as "actorId", module, action, summary, before, after, undo,
        created_at as "createdAt", undone_at as "undoneAt", undone_by as "undoneBy" ${extra}
      from audit_entries
      where guild_id = ${guildId}
        ${options.module ? this.sql`and module = ${options.module}` : this.sql``}
        ${options.modules ? this.sql`and module = any(${this.sql.array([...options.modules])}::text[])` : this.sql``}
        ${options.before ? this.sql`and id < ${options.before}` : this.sql``}
        ${this.#actor(options.actor)}
        ${options.since ? this.sql`and created_at >= ${options.since}` : this.sql``}
        ${options.until ? this.sql`and created_at < ${options.until}` : this.sql``}
        ${options.action ? this.sql`and (action = ${options.action} or action like ${`${escapeLike(options.action)}.%`})` : this.sql``}
        ${this.#kind(options.kind)}
        ${search}
      order by id desc
      ${limit === null ? this.sql`` : this.sql`limit ${limit}`}
    `;
  }

  async actors(
    guildId: string,
    limit = 50,
  ): Promise<{ actorId: string | null; entries: number }[]> {
    return this.sql<{ actorId: string | null; entries: number }[]>`
      select actor_id::text as "actorId", count(*)::int as entries
      from audit_entries
      where guild_id = ${guildId}
      group by actor_id
      order by entries desc
      limit ${Math.min(Math.max(limit, 1), 200)}
    `;
  }

  async modules(guildId: string): Promise<string[]> {
    const rows = await this.sql<{ module: string }[]>`
      select distinct module from audit_entries where guild_id = ${guildId} order by module
    `;
    return rows.map((row) => row.module);
  }

  #actor(actor: string | null | undefined) {
    if (actor === undefined) return this.sql``;
    return actor === null ? this.sql`and actor_id is null` : this.sql`and actor_id = ${actor}`;
  }

  #kind(kind: AuditKind | undefined) {
    const mod = this
      .sql`(action like 'case.%' or action like 'automod.gate.%' or action like 'automod.lockdown%')`;
    if (kind === 'auto') return this.sql`and actor_id is null`;
    if (kind === 'mod') return this.sql`and actor_id is not null and ${mod}`;
    if (kind === 'settings') return this.sql`and actor_id is not null and not ${mod}`;
    return this.sql``;
  }

  #search(search: string | undefined) {
    const term = search?.trim();
    if (!term) return this.sql``;
    return this.sql`and ${this.#matches(searchPattern(term))}`;
  }

  #matches(pattern: string) {
    return this.sql`(
      summary ilike ${pattern}
      or coalesce(before::text, '') ilike ${pattern}
      or coalesce(after::text, '') ilike ${pattern}
    )`;
  }

  #sealedReason() {
    return this.sql`(
      module = 'moderation' and action like 'case.%'
      and (before ->> 'reason' ~ ${SEALED_PATTERN} or after ->> 'reason' ~ ${SEALED_PATTERN})
    )`;
  }

  async setActor(guildId: string, id: string, actorId: string): Promise<boolean> {
    const rows = await this.sql`
      update audit_entries set actor_id = ${actorId}
      where guild_id = ${guildId} and id = ${id} and actor_id is null
      returning id
    `;
    return rows.length > 0;
  }

  async markUndone(guildId: string, id: string, by: Actor): Promise<boolean> {
    const rows = await this.sql`
      update audit_entries set undone_at = now(), undone_by = ${by.id}
      where guild_id = ${guildId} and id = ${id} and undone_at is null
      returning id
    `;
    return rows.length > 0;
  }
}
