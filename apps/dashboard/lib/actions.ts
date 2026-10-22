'use server';

import { canUndo, enqueue, moduleByKey } from '@maxwell/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { guildAccess, levelOf } from './access';
import { db } from './db';
import { editor } from './guard';
import { destroySession, getSession } from './session';

export type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const snowflake = z.string().regex(/^\d{1,21}$/);

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter(
    (key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null),
  );
}

export async function saveModule(
  guildId: string,
  module: string,
  config: unknown,
  summary?: string,
): Promise<Result<Record<string, unknown>>> {
  const definition = moduleByKey(module);
  if (!definition || !snowflake.safeParse(guildId).success)
    return { ok: false, error: 'Unknown module.' };
  const check = await editor(guildId, module);
  if ('error' in check) return { ok: false, error: check.error };
  const parsed = definition.config.safeParse(config);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return { ok: false, error: `${where}${issue?.message ?? 'Invalid settings.'}` };
  }
  const next = parsed.data as Record<string, unknown>;
  const { modules } = db();
  const before = (await modules.state(guildId, module)).config;
  const current = definition.config.safeParse(before);
  const base = (current.success ? current.data : {}) as Record<string, unknown>;
  const keys = changedKeys(base, next);
  if (keys.length > 0) {
    const patch = Object.fromEntries(keys.map((key) => [key, next[key]]));
    await modules.update(guildId, module, patch, { id: check.access.user.id }, summary);
  }
  revalidatePath(`/g/${guildId}`, 'layout');
  return { ok: true, data: next };
}

export async function setModuleEnabled(
  guildId: string,
  module: string,
  enabled: boolean,
): Promise<Result> {
  const definition = moduleByKey(module);
  if (!definition?.toggleable) return { ok: false, error: 'This module is always on.' };
  const check = await editor(guildId, module);
  if ('error' in check) return { ok: false, error: check.error };
  await db().modules.setEnabled(guildId, module, enabled, { id: check.access.user.id });
  revalidatePath(`/g/${guildId}`, 'layout');
  return { ok: true };
}

export async function undoEntry(guildId: string, entryId: string): Promise<Result> {
  const access = await guildAccess(guildId);
  if (!access) return { ok: false, error: 'You have no access to this community.' };
  const entry = await db().audit.get(guildId, entryId);
  if (!entry) return { ok: false, error: 'That change is gone.' };
  if (!access.admin && levelOf(access, entry.module) !== 'edit') {
    return { ok: false, error: 'You can only look at this page.' };
  }
  if (!canUndo(entry)) return { ok: false, error: 'That change can no longer be undone.' };
  await enqueue(db().sql, {
    kind: 'audit.undo',
    guildId,
    payload: { entryId, by: access.user.id },
    dedupeKey: `audit.undo:${entryId}`,
  });
  revalidatePath(`/g/${guildId}`, 'layout');
  return { ok: true };
}

export async function runAction(
  guildId: string,
  module: string,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<Result> {
  if (!moduleByKey(module) || !/^[a-z][a-zA-Z0-9.]{0,63}$/.test(action)) {
    return { ok: false, error: 'Unknown action.' };
  }
  const check = await editor(guildId, module);
  if ('error' in check) return { ok: false, error: check.error };
  await enqueue(db().sql, {
    kind: `${module}.${action}`,
    guildId,
    payload: { ...payload, by: check.access.user.id },
  });
  return { ok: true };
}

export async function checkVote(): Promise<Result<{ voted: boolean }>> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Sign in again.' };
  const voted = await db().votes.check(session.user.id);
  if (voted) revalidatePath('/', 'layout');
  return { ok: true, data: { voted } };
}

const grantSchema = z.object({
  subjectType: z.enum(['role', 'user']),
  subjectId: snowflake,
  module: z.string().min(1).max(32),
  level: z.enum(['view', 'edit']),
});

export async function saveAccess(guildId: string, grants: unknown): Promise<Result> {
  const access = await guildAccess(guildId);
  if (!access?.admin) return { ok: false, error: 'Only admins can change dashboard access.' };
  const parsed = z.array(grantSchema).max(500).safeParse(grants);
  if (!parsed.success) return { ok: false, error: 'Invalid access list.' };
  const { access: store, audit } = db();
  const before = await store.list(guildId);
  await store.replace(guildId, parsed.data, access.user.id);
  await audit.record({
    guildId,
    actor: { id: access.user.id },
    module: 'access',
    action: 'access.update',
    summary: 'Changed dashboard access',
    before: before.map(({ subjectType, subjectId, module, level }) => ({
      subjectType,
      subjectId,
      module,
      level,
    })),
    after: parsed.data,
    undo: null,
  });
  revalidatePath(`/g/${guildId}`, 'layout');
  return { ok: true };
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect('/login');
}
