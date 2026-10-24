'use server';

import { z } from 'zod';
import { type Result, runAction } from '@/lib/actions';
import { viewer } from '@/lib/guard';
import type { Names } from '@/lib/people';
import { loadSubmissions, type SubmissionView } from './load';

const id = z.string().regex(/^\d{1,19}$/);

const query = z.object({
  formId: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/)
    .optional(),
  decided: z.boolean(),
  before: id.optional(),
});

export async function fetchSubmissions(
  guildId: string,
  input: { formId?: string; decided: boolean; before?: string },
): Promise<Result<{ items: SubmissionView[]; names: Names; more: boolean }>> {
  const check = await viewer(guildId, 'forms');
  if ('error' in check) return { ok: false, error: check.error };
  const parsed = query.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid filter.' };
  return { ok: true, data: await loadSubmissions(guildId, parsed.data) };
}

export async function decide(
  guildId: string,
  submissionId: string,
  decision: 'accept' | 'decline',
  note: string,
): Promise<Result> {
  if (!id.safeParse(submissionId).success) return { ok: false, error: 'Unknown response.' };
  if (decision !== 'accept' && decision !== 'decline') {
    return { ok: false, error: 'Unknown decision.' };
  }
  const text = note.trim();
  if (text.length > 500) return { ok: false, error: 'Keep the note under 500 characters.' };
  return runAction(guildId, 'forms', 'review', { submissionId, decision, note: text || null });
}
