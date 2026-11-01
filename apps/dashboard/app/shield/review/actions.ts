'use server';

import { enqueue } from '@maxwell/core';
import { DISPUTE_NOTE_MAX, ShieldDisputeStore } from '@maxwell/core/stores/shield-disputes';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Result } from '@/lib/actions';
import { db } from '@/lib/db';
import { operatorSession } from './data';

const input = z.object({
  id: z.string().regex(/^\d{1,19}$/),
  action: z.enum(['remove', 'keep']),
  note: z.string().trim().max(DISPUTE_NOTE_MAX),
});

export async function decideDispute(raw: z.input<typeof input>): Promise<Result> {
  const operator = await operatorSession();
  if (!operator) return { ok: false, error: 'Sign in again.' };
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Keep the note under 500 characters.' };
  const { id, action, note } = parsed.data;
  const result = await new ShieldDisputeStore(db().sql).decide(
    id,
    operator.id,
    action,
    note || null,
  );
  switch (result.kind) {
    case 'missing':
      return { ok: false, error: 'That dispute is gone.' };
    case 'closed':
      return { ok: false, error: 'That dispute is already decided.' };
    case 'note':
      return { ok: false, error: 'Write a short note for the user.' };
    case 'decided':
      break;
  }
  await enqueue(db().sql, { kind: 'security.shield.dispute.notify', payload: { id } });
  revalidatePath('/shield/review');
  return { ok: true };
}
