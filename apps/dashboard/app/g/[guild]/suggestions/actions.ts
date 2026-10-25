'use server';

import { suggestionStatuses } from '@maxwell/core/modules/suggestions';
import { z } from 'zod';
import { type Result, runAction } from '@/lib/actions';
import { viewer } from '@/lib/guard';
import { type Item, loadPage } from './load';

const query = z.object({
  status: z.enum(suggestionStatuses).optional(),
  sort: z.enum(['top', 'new']),
  offset: z.number().int().min(0).max(100_000),
  before: z
    .string()
    .regex(/^\d{1,19}$/)
    .optional(),
});

export async function loadMore(
  guildId: string,
  input: { status?: string; sort: string; offset: number; before?: string },
): Promise<Result<{ items: Item[]; more: boolean }>> {
  const check = await viewer(guildId, 'suggestions');
  if ('error' in check) return { ok: false, error: check.error };
  const parsed = query.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid filter.' };
  const { status, sort, offset, before } = parsed.data;
  return { ok: true, data: await loadPage(guildId, status, sort, offset, before) };
}

const change = z.object({
  suggestionId: z.string().regex(/^\d{1,19}$/),
  status: z.enum(suggestionStatuses),
  reason: z.string().trim().max(1000),
});

export async function setStatus(
  guildId: string,
  input: { suggestionId: string; status: string; reason: string },
): Promise<Result> {
  const parsed = change.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Keep the reason under 1,000 characters.' };
  return runAction(guildId, 'suggestions', 'status', {
    suggestionId: parsed.data.suggestionId,
    status: parsed.data.status,
    reason: parsed.data.reason || null,
  });
}
