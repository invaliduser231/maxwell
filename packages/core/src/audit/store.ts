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
    const [row] = await this.sql<{ id: string }[]>`
      insert into audit_entries (guild_id, actor_id, module, action, summary, before, after, undo)
      values (
        ${input.guildId},
        ${input.actor.id},
        ${input.module},
        ${input.action},
        ${input.summary},
        ${input.before === undefined ? null : this.sql.json(input.before as never)},
        ${input.after === undefined ? null : this.sql.json(input.after as never)},
        ${input.undo ? this.sql.json(input.undo as never) : null}
      )
      returning id
    `;
    return row?.id ?? '';
  }

  async get(guildId: string, id: string): Promise<AuditEntry | null> {
    const [row] = await this.sql<AuditEntry[]>`
      select id, guild_id as "guildId", actor_id as "actorId", module, action, summary, before, after, undo,
        created_at as "createdAt", undone_at as "undoneAt", undone_by as "undoneBy"
      from audit_entries where guild_id = ${guildId} and id = ${id}
    `;
    return row ?? null;
  }

  async list(guildId: string, options: AuditFilter = {}): Promise<AuditEntry[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    return this.sql<AuditEntry[]>`
      select id, guild_id as "guildId", actor_id as "actorId", module, action, summary, before, after, undo,
        created_at as "createdAt", undone_at as "undoneAt", undone_by as "undoneBy"
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
        ${this.#search(options.search)}
      order by id desc
      limit ${limit}
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
    const pattern = `%${escapeLike(term.slice(0, 100))}%`;
    return this.sql`and (
      summary ilike ${pattern}
      or coalesce(before::text, '') ilike ${pattern}
      or coalesce(after::text, '') ilike ${pattern}
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
