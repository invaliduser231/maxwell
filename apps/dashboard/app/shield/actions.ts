'use server';

import { DISPUTE_MAX, DISPUTE_MIN, ShieldDisputeStore } from '@maxwell/core/stores/shield-disputes';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Result } from '@/lib/actions';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';

const text = z.string().trim().min(DISPUTE_MIN).max(DISPUTE_MAX);

export async function sendDispute(body: string): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Sign in again.' };
  const parsed = text.safeParse(body);
  if (!parsed.success) return { ok: false, error: 'Write between 20 and 2,000 characters.' };
  const result = await new ShieldDisputeStore(db().sql).file(session.user.id, parsed.data);
  if (result.kind !== 'created') {
    return { ok: false, error: 'This dispute cannot be sent right now.' };
  }
  revalidatePath('/shield');
  return { ok: true };
}
