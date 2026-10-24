'use server';

import { BackupStore } from '@maxwell/core/stores/backups';
import { z } from 'zod';
import { type Result, runAction } from '@/lib/actions';
import { db } from '@/lib/db';
import { editor, viewer } from '@/lib/guard';
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
  const importId = await new BackupStore(db().sql).createImport(
    guildId,
    input.slice(0, 100),
    check.access.user.id,
  );
  if (!importId) return { ok: false, error: 'That did not work. Try again.' };
  const queued = await runAction(guildId, 'backups', 'import.preview', {
    code: input,
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
