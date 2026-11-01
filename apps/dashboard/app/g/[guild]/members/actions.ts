'use server';

import { ModerationStore } from '@maxwell/core/stores/moderation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { type Result, runAction } from '@/lib/actions';
import { db } from '@/lib/db';
import { userProfile } from '@/lib/fluxer';
import { editor } from '@/lib/guard';

const MODULE = 'moderation';
const snowflake = z.string().regex(/^\d{1,21}$/);

const actionInput = z.object({
  action: z.enum(['ban', 'unban', 'kick', 'timeout', 'untimeout', 'warn']),
  userId: snowflake,
  reason: z.string().trim().max(1_500),
  durationSeconds: z.number().int().positive().max(63_072_000).nullable(),
  shield: z.boolean().default(false),
  deleteMessages: z.boolean().default(false),
});

export async function memberAction(
  guildId: string,
  input: z.input<typeof actionInput>,
): Promise<Result> {
  const check = await editor(guildId, MODULE);
  if ('error' in check) return { ok: false, error: check.error };
  const parsed = actionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the action first.' };
  const { action, userId, reason, durationSeconds, shield, deleteMessages } = parsed.data;
  if (userId === check.access.user.id && action !== 'unban' && action !== 'untimeout') {
    return { ok: false, error: 'That is you.' };
  }
  return runAction(guildId, MODULE, 'action', {
    action,
    userId,
    reason: reason || null,
    durationSeconds: action === 'timeout' || action === 'ban' ? durationSeconds : null,
    moderatorId: check.access.user.id,
    shield: action === 'ban' && shield,
    deleteMessages: action === 'ban' && deleteMessages,
  });
}

export async function addNote(guildId: string, userId: string, body: string): Promise<Result> {
  const check = await editor(guildId, MODULE);
  if ('error' in check) return { ok: false, error: check.error };
  if (!snowflake.safeParse(userId).success) return { ok: false, error: 'Unknown member.' };
  const text = body.trim().slice(0, 1_000);
  if (!text) return { ok: false, error: 'Write something first.' };
  const note = await new ModerationStore(db().sql).addNote(
    guildId,
    userId,
    check.access.user.id,
    text,
  );
  const profile = await userProfile(userId).catch(() => null);
  await db().audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: MODULE,
    action: 'note.add',
    summary: `Added a note on ${profile ? `@${profile.username}` : userId}`,
    after: { note: note.id, userId },
    undo: { kind: 'moderation.note', payload: { id: note.id } },
  });
  revalidatePath(`/g/${guildId}/members`);
  return { ok: true };
}

export async function removeNote(guildId: string, noteId: string): Promise<Result> {
  const check = await editor(guildId, MODULE);
  if ('error' in check) return { ok: false, error: check.error };
  if (!/^\d{1,20}$/.test(noteId)) return { ok: false, error: 'Unknown note.' };
  const removed = await new ModerationStore(db().sql).deleteNote(guildId, noteId);
  if (!removed) return { ok: false, error: 'That note is already gone.' };
  await db().audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: MODULE,
    action: 'note.remove',
    summary: `Removed note #${noteId}`,
    after: { note: noteId },
    undo: { kind: 'moderation.note.restore', payload: { id: noteId } },
  });
  revalidatePath(`/g/${guildId}/members`);
  return { ok: true };
}
