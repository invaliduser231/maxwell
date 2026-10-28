'use server';

import { enqueue } from '@maxwell/core';
import { InboxStore } from '@maxwell/core/stores/inbox';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Result } from '@/lib/actions';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { appealState } from './data';

const text = z.string().trim().min(20).max(2_000);

export async function sendAppeal(guildId: string, body: string): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Sign in again.' };
  const parsed = text.safeParse(body);
  if (!parsed.success) return { ok: false, error: 'Write between 20 and 2,000 characters.' };
  const state = await appealState(guildId, session.user.id);
  if (state.kind !== 'ready') return { ok: false, error: 'This appeal cannot be sent right now.' };
  const result = await new InboxStore(db().sql).appeal({
    guildId,
    subjectId: session.user.id,
    body: parsed.data,
    caseNumber: state.banCase,
  });
  if (result.kind !== 'created') {
    return { ok: false, error: 'This appeal cannot be sent right now.' };
  }
  await enqueue(db().sql, {
    kind: 'moderation.inbox.notify',
    guildId,
    payload: { number: result.item.number },
  });
  revalidatePath(`/appeal/${guildId}`);
  return { ok: true };
}
