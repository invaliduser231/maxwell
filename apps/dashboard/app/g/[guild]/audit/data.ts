import 'server-only';
import { type AuditEntry, type AuditFilter, canUndo, moduleByKey } from '@maxwell/core';
import { db } from '@/lib/db';
import { allPages, pageByKey } from '@/lib/pages';
import { people, personOf } from '@/lib/people';
import { type DiffLine, diff } from './diff';
import { type AuditQuery, MAXWELL, PAGE_SIZE } from './format';

export interface AuditRow {
  id: string;
  actorId: string | null;
  actorName: string;
  actorAvatar: string | null;
  module: string;
  moduleName: string;
  action: string;
  summary: string;
  createdAt: string;
  undoneAt: string | null;
  undoable: boolean;
  hasUndo: boolean;
  diff: DiffLine[];
}

export function moduleName(key: string): string {
  return (
    allPages.find((page) => page.module === key && page.key === key)?.name ??
    pageByKey(key)?.name ??
    moduleByKey(key)?.name ??
    key
  );
}

export function filterFor(query: AuditQuery, now = Date.now()): AuditFilter {
  const filter: AuditFilter = {};
  if (query.module) filter.module = query.module;
  if (query.actor === MAXWELL) filter.actor = null;
  else if (query.actor) filter.actor = query.actor;
  if (query.range !== 'any') filter.since = new Date(now - Number(query.range) * 86_400_000);
  if (query.kind !== 'all') filter.kind = query.kind;
  if (query.search.trim()) filter.search = query.search.trim();
  return filter;
}

export async function toRows(entries: AuditEntry[]): Promise<AuditRow[]> {
  const known = await people(entries.map((entry) => entry.actorId));
  const now = Date.now();
  return entries.map((entry) => {
    const actor = entry.actorId ? personOf(known, entry.actorId) : null;
    return {
      id: String(entry.id),
      actorId: entry.actorId ? String(entry.actorId) : null,
      actorName: actor ? actor.name : 'Maxwell',
      actorAvatar: actor ? actor.avatar : '/mascot/neutral.svg',
      module: entry.module,
      moduleName: moduleName(entry.module),
      action: entry.action,
      summary: entry.summary,
      createdAt: entry.createdAt.toISOString(),
      undoneAt: entry.undoneAt ? entry.undoneAt.toISOString() : null,
      undoable: canUndo(entry, now),
      hasUndo: entry.undo !== null,
      diff: diff(entry.before, entry.after, moduleName),
    };
  });
}

export async function loadEntries(
  guildId: string,
  query: AuditQuery,
  before?: string,
  modules?: readonly string[],
): Promise<{ rows: AuditRow[]; more: boolean }> {
  const entries = await db().audit.list(guildId, {
    ...filterFor(query),
    modules,
    before,
    limit: PAGE_SIZE + 1,
  });
  const rows = await toRows(entries.slice(0, PAGE_SIZE));
  return { rows, more: entries.length > PAGE_SIZE };
}
