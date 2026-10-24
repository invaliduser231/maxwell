'use server';

import { catalog } from '@maxwell/core';
import { z } from 'zod';
import { levelOf } from '@/lib/access';
import type { Result } from '@/lib/actions';
import { db } from '@/lib/db';
import { admin, viewer } from '@/lib/guard';
import { type AuditRow, loadEntries } from './data';

const querySchema = z.object({
  module: z.string().max(32).nullable(),
  actor: z.union([z.literal('maxwell'), z.string().regex(/^\d{1,21}$/)]).nullable(),
  range: z.enum(['any', '1', '7', '30', '90']),
  kind: z.enum(['all', 'settings', 'mod', 'auto']),
  search: z.string().max(100),
});

const idSchema = z.string().regex(/^\d{1,20}$/);

export async function loadAudit(
  guildId: string,
  query: unknown,
  before?: string,
): Promise<Result<{ rows: AuditRow[]; more: boolean }>> {
  const check = await admin(guildId);
  if ('error' in check) return { ok: false, error: check.error };
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) return { ok: false, error: 'Those filters do not work.' };
  if (before !== undefined && !idSchema.safeParse(before).success) {
    return { ok: false, error: 'Those filters do not work.' };
  }
  return { ok: true, data: await loadEntries(guildId, parsed.data, before) };
}

export async function undoneStates(
  guildId: string,
  ids: string[],
): Promise<Result<Record<string, boolean>>> {
  const check = await viewer(guildId, null);
  if ('error' in check) return { ok: false, error: check.error };
  const wanted = ids.filter((id) => idSchema.safeParse(id).success).slice(0, 20);
  const { access } = check;
  const visible = new Set(
    catalog.filter((module) => levelOf(access, module.key) !== 'none').map((m) => m.key),
  );
  const states: Record<string, boolean> = {};
  for (const id of wanted) {
    const entry = await db().audit.get(guildId, id);
    if (!entry) continue;
    if (!access.admin && !visible.has(entry.module)) continue;
    states[id] = entry.undoneAt !== null;
  }
  return { ok: true, data: states };
}
