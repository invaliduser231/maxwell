'use server';

import { cancel } from '@maxwell/core';
import { ReminderStore } from '@maxwell/core/stores/scheduler';
import { revalidatePath } from 'next/cache';
import type { Result } from '@/lib/actions';
import { db } from '@/lib/db';
import { editor } from '@/lib/guard';

export async function cancelReminder(guildId: string, reminderId: string): Promise<Result> {
  const check = await editor(guildId, 'scheduler');
  if ('error' in check) return { ok: false, error: check.error };
  if (!/^\d{1,20}$/.test(reminderId)) return { ok: false, error: 'That reminder is gone.' };
  const { sql, audit } = db();
  const row = await new ReminderStore(sql).remove(guildId, reminderId);
  if (!row) return { ok: false, error: 'That reminder is gone.' };
  await cancel(sql, `scheduler.reminder:${row.id}`);
  await audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: 'scheduler',
    action: 'reminder.cancel',
    summary: 'Cancelled a member reminder',
    before: {
      id: row.id,
      userId: row.userId,
      channelId: row.channelId,
      content: row.content,
      dueAt: row.dueAt.toISOString(),
    },
    undo: null,
  });
  revalidatePath(`/g/${guildId}/scheduler`);
  return { ok: true };
}
