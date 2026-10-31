'use server';

import { BackupStore } from '@maxwell/core/stores/backups';
import { revalidatePath } from 'next/cache';
import type { Result } from '@/lib/actions';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { mayRemove } from '@/lib/templates';

export async function removeTemplate(templateId: string): Promise<Result> {
  if (!/^\d{1,18}$/.test(templateId)) return { ok: false, error: 'That template is gone.' };
  const session = await getSession();
  if (!session) return { ok: false, error: 'Sign in again.' };
  const store = new BackupStore(db().sql);
  const template = await store.template(templateId);
  if (!template) return { ok: false, error: 'That template is gone.' };
  const guildId = String(template.guildId);
  if (!(await mayRemove(session.user, guildId))) {
    return { ok: false, error: 'You cannot remove this template.' };
  }
  const removed = await store.removeTemplate(templateId);
  if (!removed) return { ok: false, error: 'That template is gone.' };
  await db().audit.record({
    guildId,
    actor: { id: session.user.id },
    module: 'backups',
    action: 'template.remove',
    summary: `Removed the template ${removed.title}`,
    before: { templateId, title: removed.title },
    after: null,
    undo: null,
  });
  revalidatePath('/templates');
  return { ok: true };
}
