'use server';

import { FeedStore } from '@maxwell/core/stores/feeds';
import { db } from '@/lib/db';
import { editor } from '@/lib/guard';

export async function feedTestOutcome(
  guildId: string,
  requestId: string,
): Promise<{ ok: true; outcome: string | null } | { ok: false; error: string }> {
  if (!/^[\w-]{8,64}$/.test(requestId)) return { ok: false, error: 'Invalid request.' };
  const check = await editor(guildId, 'feeds');
  if ('error' in check) return { ok: false, error: check.error };
  const outcome = await new FeedStore(db().sql).testOutcome(guildId, requestId);
  return { ok: true, outcome };
}
