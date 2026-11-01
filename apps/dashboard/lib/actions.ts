'use server';

import { canUndo, enqueue, moduleByKey } from '@maxwell/core';
import { revalidatePath, updateTag } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { guildAccess, levelOf } from './access';
import { db } from './db';
import { editor } from './guard';
import { isLang, LANG_COOKIE } from './i18n';
import { publicTag } from './public-page';
import { destroySession, getSession, secureCookies } from './session';

export type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const snowflake = z.string().regex(/^\d{1,21}$/);

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter(
    (key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null),
  );
}

const MERGE_MS = 10 * 60_000;

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
    await modules.update(guildId, module, patch, { id: check.access.user.id }, summary, {
      mergeWithin: summary ? undefined : MERGE_MS,
    });
    updateTag(publicTag(guildId));
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
  updateTag(publicTag(guildId));
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

const ACTIONS = new Set([
  'automod.dryrun',
  'automod.gate.banall',
  'automod.gate.letin',
  'automod.gate.setup',
  'automod.lockdown.end',
  'backups.import.apply',
  'backups.import.preview',
  'backups.restore',
  'backups.snapshot',
  'commands.test',
  'economy.reset',
  'economy.restock',
  'events.poll.close',
  'events.poll.publish',
  'events.publish',
  'feeds.resume',
  'feeds.test',
  'forms.review',
  'games.resetChannel',
  'giveaways.cancel',
  'giveaways.end',
  'giveaways.reroll',
  'giveaways.start',
  'insights.digest.test',
  'levels.import',
  'logs.test',
  'moderation.action',
  'moderation.inbox.assign',
  'moderation.inbox.resolve',
  'moderation.massban',
  'moderation.review',
  'moderation.sync',
  'roles.menu.publish',
  'roles.menu.remove',
  'scheduler.post',
  'security.gate.setup',
  'security.honeypot.setup',
  'security.incident.undo',
  'security.pass',
  'security.raid.start',
  'security.raid.stop',
  'security.shield.remove',
  'suggestions.status',
  'tickets.claim',
  'tickets.close',
  'tickets.member.add',
  'tickets.panel.publish',
  'tickets.panel.remove',
  'tickets.reopen',
  'tickets.reply',
  'welcome.preview',
  'welcome.rules.publish',
  'welcome.rules.remove',
]);

const ACTORS: Record<string, { field: string; nullable?: boolean }> = {
  'automod.dryrun': { field: 'requestedBy' },
  'commands.test': { field: 'userId' },
  'giveaways.start': { field: 'hostId' },
  'moderation.action': { field: 'moderatorId' },
  'moderation.inbox.assign': { field: 'assigneeId', nullable: true },
  'moderation.massban': { field: 'moderatorId' },
  'moderation.review': { field: 'moderatorId' },
  'tickets.claim': { field: 'userId', nullable: true },
  'welcome.preview': { field: 'userId' },
};

export async function runAction(
  guildId: string,
  module: string,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<Result> {
  const kind = `${module}.${action}`;
  if (!moduleByKey(module) || !ACTIONS.has(kind)) {
    return { ok: false, error: 'Unknown action.' };
  }
  const check = await editor(guildId, module);
  if ('error' in check) return { ok: false, error: check.error };
  const by = check.access.user.id;
  const data: Record<string, unknown> = { ...payload, by };
  const actor = ACTORS[kind];
  if (actor && !(actor.nullable && data[actor.field] === null)) data[actor.field] = by;
  await enqueue(db().sql, { kind, guildId, payload: data });
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

export async function setLanguage(lang: string): Promise<void> {
  if (!isLang(lang)) return;
  const store = await cookies();
  store.set(LANG_COOKIE, lang, {
    path: '/',
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60,
    secure: secureCookies(),
  });
  revalidatePath('/', 'layout');
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect('/login');
}
