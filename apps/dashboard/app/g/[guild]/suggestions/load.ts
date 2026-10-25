import 'server-only';
import type { SuggestionStatus } from '@maxwell/core/modules/suggestions';
import { type Suggestion, SuggestionStore } from '@maxwell/core/stores/suggestions';
import { db } from '@/lib/db';
import { people, personOf } from '@/lib/people';

export const PAGE = 25;

export type Sort = 'top' | 'new';

export interface Item {
  id: string;
  number: number;
  content: string;
  status: SuggestionStatus;
  reason: string | null;
  up: number;
  down: number;
  author: string | null;
  statusBy: string | null;
  createdAt: string;
}

export async function toItems(rows: readonly Suggestion[]): Promise<Item[]> {
  const known = await people(rows.flatMap((row) => [row.authorId, row.statusBy]));
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    content: row.content,
    status: row.status,
    reason: row.reason,
    up: row.up,
    down: row.down,
    author: row.authorId ? personOf(known, row.authorId).name : null,
    statusBy: row.statusBy ? (known.get(row.statusBy)?.name ?? null) : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function loadPage(
  guildId: string,
  status: SuggestionStatus | undefined,
  sort: Sort,
  offset: number,
  before?: string,
): Promise<{ items: Item[]; more: boolean }> {
  const store = new SuggestionStore(db().sql);
  const rows =
    sort === 'top'
      ? await store.top(guildId, { status, limit: PAGE + 1, offset })
      : await store.list(guildId, { status, limit: PAGE + 1, before });
  return { items: await toItems(rows.slice(0, PAGE)), more: rows.length > PAGE };
}
