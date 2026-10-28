'use server';

import { z } from 'zod';
import { type Result, runAction } from '@/lib/actions';
import { editor, viewer } from '@/lib/guard';
import { type InboxDetail, inboxDetail } from './data';

const MODULE = 'moderation';
const number = z.number().int().positive().max(2_147_483_647);

export async function loadItem(guildId: string, n: number): Promise<Result<InboxDetail>> {
  const check = await viewer(guildId, MODULE);
  if ('error' in check) return { ok: false, error: check.error };
  if (!number.safeParse(n).success) return { ok: false, error: 'Unknown item.' };
  const detail = await inboxDetail(guildId, n);
  return detail ? { ok: true, data: detail } : { ok: false, error: 'That item is gone.' };
}

export async function claimItem(guildId: string, n: number, claim: boolean): Promise<Result> {
  const check = await editor(guildId, MODULE);
  if ('error' in check) return { ok: false, error: check.error };
  if (!number.safeParse(n).success) return { ok: false, error: 'Unknown item.' };
  return runAction(guildId, MODULE, 'inbox.assign', {
    number: n,
    assigneeId: claim ? check.access.user.id : null,
  });
}

const resolution = z.object({
  number,
  status: z.enum(['resolved', 'dismissed']),
  action: z.enum(['warn', 'timeout', 'kick', 'ban']).nullable(),
  durationSeconds: z.number().int().positive().max(63_072_000).nullable(),
  reason: z.string().trim().max(1_500),
  deleteMessage: z.boolean(),
  note: z.string().trim().max(1_500),
});

export async function resolveItem(
  guildId: string,
  input: z.input<typeof resolution>,
): Promise<Result> {
  const parsed = resolution.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Keep reason and note under 1,500 characters.' };
  const data = parsed.data;
  return runAction(guildId, MODULE, 'inbox.resolve', {
    number: data.number,
    status: data.status,
    action: data.status === 'resolved' ? data.action : null,
    durationSeconds:
      data.action === 'timeout' || data.action === 'ban' ? data.durationSeconds : null,
    reason: data.reason || null,
    deleteMessage: data.status === 'resolved' && data.deleteMessage,
    note: data.note || null,
  });
}
