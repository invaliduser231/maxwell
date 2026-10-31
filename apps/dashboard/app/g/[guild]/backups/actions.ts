'use server';

import { sanitizeTemplate } from '@maxwell/core/modules/backups';
import { BackupStore } from '@maxwell/core/stores/backups';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { levelOf } from '@/lib/access';
import { type Result, runAction } from '@/lib/actions';
import { db } from '@/lib/db';
import { guildRoles } from '@/lib/fluxer';
import { editor, viewer } from '@/lib/guard';
import {
  canRemoveTemplate,
  parsePublish,
  parseTemplateLink,
  type TemplateCard,
} from '@/lib/template-view';
import { toCard } from '@/lib/templates';
import {
  compare,
  type DiffView,
  type ImportView,
  loadImport,
  type SnapshotRow,
  snapshotRows,
  type Usage,
  usage,
} from './data';

const id = z.string().regex(/^\d{1,20}$/);

export async function compareSnapshots(
  guildId: string,
  oldId: string,
  newId: string,
): Promise<Result<DiffView>> {
  const check = await viewer(guildId, 'backups');
  if ('error' in check) return { ok: false, error: check.error };
  if (!id.safeParse(oldId).success || !id.safeParse(newId).success) {
    return { ok: false, error: 'Pick two snapshots.' };
  }
  return { ok: true, data: await compare(guildId, oldId, newId) };
}

export async function listSnapshots(
  guildId: string,
): Promise<Result<{ snapshots: SnapshotRow[]; usage: Usage }>> {
  const check = await viewer(guildId, 'backups');
  if ('error' in check) return { ok: false, error: check.error };
  const [snapshots, totals] = await Promise.all([snapshotRows(guildId), usage(guildId)]);
  return { ok: true, data: { snapshots, usage: totals } };
}

const pickSchema = z.object({
  roles: z.array(id).max(500),
  channels: z.array(id).max(1000),
  modules: z.array(z.string().regex(/^[a-z][a-zA-Z0-9]{0,31}$/)).max(50),
});

export async function restoreSnapshot(
  guildId: string,
  snapshotId: string,
  pick: unknown,
): Promise<Result> {
  if (!id.safeParse(snapshotId).success) return { ok: false, error: 'Unknown snapshot.' };
  if (pick === null) return runAction(guildId, 'backups', 'restore', { snapshotId, scope: 'full' });
  const parsed = pickSchema.safeParse(pick);
  if (!parsed.success) return { ok: false, error: 'Pick what to restore.' };
  const { roles, channels, modules } = parsed.data;
  if (roles.length + channels.length + modules.length === 0) {
    return { ok: false, error: 'Pick what to restore.' };
  }
  return runAction(guildId, 'backups', 'restore', {
    snapshotId,
    scope: 'pick',
    roles,
    channels,
    modules,
  });
}

export async function readTemplate(guildId: string, link: string): Promise<Result<{ id: string }>> {
  const check = await editor(guildId, 'backups');
  if ('error' in check) return { ok: false, error: check.error };
  const input = link.trim();
  if (input.length < 2 || input.length > 200) {
    return { ok: false, error: 'Paste a Discord template link.' };
  }
  const store = new BackupStore(db().sql);
  const templateId = parseTemplateLink(input);
  if (templateId && !(await store.template(templateId))) {
    return { ok: false, error: 'That template is no longer published.' };
  }
  const code = templateId ? `template:${templateId}` : input;
  const importId = await store.createImport(guildId, code.slice(0, 100), check.access.user.id);
  if (!importId) return { ok: false, error: 'That did not work. Try again.' };
  const queued = await runAction(guildId, 'backups', 'import.preview', {
    code,
    importId: String(importId),
  });
  if (!queued.ok) return queued;
  return { ok: true, data: { id: String(importId) } };
}

export async function importStatus(guildId: string, importId: string): Promise<Result<ImportView>> {
  const check = await viewer(guildId, 'backups');
  if ('error' in check) return { ok: false, error: check.error };
  if (!id.safeParse(importId).success) return { ok: false, error: 'Unknown import.' };
  const view = await loadImport(guildId, importId);
  if (!view) return { ok: false, error: 'That import is gone.' };
  return { ok: true, data: view };
}

export async function applyTemplate(guildId: string, importId: string): Promise<Result> {
  if (!id.safeParse(importId).success) return { ok: false, error: 'Unknown import.' };
  return runAction(guildId, 'backups', 'import.apply', { importId });
}

async function managedRoles(guildId: string): Promise<Set<string>> {
  const roles = await guildRoles(guildId).catch(() => []);
  return new Set(roles.filter((role) => role.managed).map((role) => role.id));
}

export async function publishTemplate(
  guildId: string,
  input: unknown,
): Promise<Result<TemplateCard>> {
  const check = await editor(guildId, 'backups');
  if ('error' in check) return { ok: false, error: check.error };
  const parsed = parsePublish(input);
  if ('error' in parsed) return { ok: false, error: parsed.error };
  const store = new BackupStore(db().sql);
  const snapshot = await store.get(guildId, parsed.snapshotId);
  if (!snapshot) return { ok: false, error: 'Unknown snapshot.' };
  const data = sanitizeTemplate(guildId, snapshot.data, {
    skipRoles: await managedRoles(guildId),
  });
  if (data.roles.length + data.channels.length === 0) {
    return { ok: false, error: 'That snapshot has no roles or channels.' };
  }
  const published = await store.publishTemplate(guildId, {
    title: parsed.title,
    description: parsed.description,
    guildName: parsed.showName ? check.access.guild.name.slice(0, 100) : null,
    data,
  });
  if (!published) {
    return { ok: false, error: 'A community can publish 5 templates. Unpublish one first.' };
  }
  await db().audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: 'backups',
    action: 'template.publish',
    summary: `Published the template ${published.title}`,
    after: {
      templateId: String(published.id),
      snapshot: snapshot.number,
      roles: published.roleCount,
      channels: published.channelCount,
      showName: parsed.showName,
    },
    undo: null,
  });
  revalidatePath('/templates');
  return { ok: true, data: toCard(published) };
}

export async function unpublishTemplate(guildId: string, templateId: string): Promise<Result> {
  if (!id.safeParse(templateId).success) return { ok: false, error: 'That template is gone.' };
  const check = await viewer(guildId, 'backups');
  if ('error' in check) return { ok: false, error: check.error };
  if (!canRemoveTemplate(false, levelOf(check.access, 'backups'))) {
    return { ok: false, error: 'You can only look at this page.' };
  }
  const removed = await new BackupStore(db().sql).removeTemplate(templateId, guildId);
  if (!removed) return { ok: false, error: 'That template is gone.' };
  await db().audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: 'backups',
    action: 'template.unpublish',
    summary: `Unpublished the template ${removed.title}`,
    before: { templateId, title: removed.title },
    undo: null,
  });
  revalidatePath('/templates');
  return { ok: true };
}
