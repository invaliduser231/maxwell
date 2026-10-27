import 'server-only';
import { moduleByKey } from '@maxwell/core';
import {
  diffSnapshots,
  type FieldChange,
  type OverwriteChange,
  type PermissionDelta,
  type SnapshotChannel,
  type SnapshotData,
  type SnapshotRole,
} from '@maxwell/core/modules/backups';
import { BackupStore, type ImportRow, type SnapshotMeta } from '@maxwell/core/stores/backups';
import { db } from '@/lib/db';
import type { Translator } from '@/lib/i18n';
import { getT } from '@/lib/i18n/server';
import { people } from '@/lib/people';

const CATEGORY = 4;
const TEXT_TYPES = new Set([0, 5, 15]);

export interface SnapshotRow {
  id: string;
  number: number;
  kind: 'daily' | 'manual';
  label: string | null;
  by: string | null;
  createdAt: string;
  roleCount: number;
  channelCount: number;
  moduleCount: number;
}

export interface DiffItem {
  key: string;
  group: 'Roles' | 'Channels' | 'Maxwell settings';
  sign: '+' | '-' | '~';
  label: string;
  detail: string;
  restore: { kind: 'role' | 'channel' | 'module'; id: string } | null;
}

export interface DiffView {
  oldId: string;
  newId: string;
  items: DiffItem[];
}

export interface ImportView {
  id: string;
  status: ImportRow['status'];
  error: string | null;
  name: string | null;
  roles: number;
  categories: number;
  channels: number;
  overwrites: number;
  skipped: number;
  created: { roles: number; channels: number; failed: number } | null;
}

export interface Usage {
  count: number;
  bytes: number;
  lastDaily: string | null;
}

function store(): BackupStore {
  return new BackupStore(db().sql);
}

async function names(ids: readonly string[]): Promise<Map<string, string>> {
  const known = await people(ids, 20);
  return new Map(
    [...known.values()].flatMap((person) => (person.known ? [[person.id, person.name]] : [])),
  );
}

function toRow(meta: SnapshotMeta, by: Map<string, string>): SnapshotRow {
  return {
    id: String(meta.id),
    number: meta.number,
    kind: meta.kind,
    label: meta.label,
    by: meta.createdBy ? (by.get(meta.createdBy) ?? null) : null,
    createdAt: new Date(meta.createdAt).toISOString(),
    roleCount: meta.roleCount,
    channelCount: meta.channelCount,
    moduleCount: meta.moduleCount,
  };
}

export async function snapshotRows(guildId: string): Promise<SnapshotRow[]> {
  const list = await store().list(guildId, 60);
  const by = await names(list.flatMap((meta) => (meta.createdBy ? [meta.createdBy] : [])));
  return list.map((meta) => toRow(meta, by));
}

export async function usage(guildId: string): Promise<Usage> {
  const [totals, lastDaily] = await Promise.all([
    store().usage(guildId),
    store().latestAt(guildId, 'daily'),
  ]);
  return {
    count: totals.count,
    bytes: totals.bytes,
    lastDaily: lastDaily ? new Date(lastDaily).toISOString() : null,
  };
}

function words(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Tts/g, 'TTS');
}

function permissionText(t: Translator, delta: PermissionDelta): string[] {
  const out: string[] = [];
  if (delta.added.length > 0) {
    out.push(t('{names} added', { names: t.list(delta.added.map(words)) }));
  }
  if (delta.removed.length > 0) {
    out.push(t('{names} removed', { names: t.list(delta.removed.map(words)) }));
  }
  return out;
}

function channelLabel(channel: { name: string; type: number }): string {
  return TEXT_TYPES.has(channel.type) ? `#${channel.name}` : channel.name;
}

function slowmode(t: Translator, value: unknown): string {
  return typeof value === 'number' && value > 0 ? t('{count} seconds', { count: value }) : t('off');
}

function fieldText(t: Translator, change: FieldChange, channel: boolean): string | null {
  switch (change.field) {
    case 'id':
      return t('deleted and created again');
    case 'name':
      return t('renamed from {name}', { name: `${channel ? '#' : ''}${String(change.before)}` });
    case 'color':
      return t('color changed');
    case 'hoist':
      return change.after ? t('now shown separately') : t('no longer shown separately');
    case 'mentionable':
      return change.after ? t('now mentionable') : t('no longer mentionable');
    case 'parentId':
      return t('moved to another category');
    case 'type':
      return t('type changed');
    case 'topic':
      return t('topic changed');
    case 'userLimit':
      return t('user limit {before} to {after}', {
        before:
          change.before === null || change.before === undefined ? t('none') : String(change.before),
        after:
          change.after === null || change.after === undefined ? t('none') : String(change.after),
      });
    case 'nsfw':
      return change.after ? t('marked NSFW') : t('no longer NSFW');
    case 'rateLimitPerUser':
      return t('slowmode {before} to {after}', {
        before: slowmode(t, change.before),
        after: slowmode(t, change.after),
      });
    default:
      return null;
  }
}

function overwriteText(t: Translator, change: OverwriteChange, target: string): string {
  if (change.status === 'added') return t('{target} overwrite added', { target });
  if (change.status === 'removed') return t('{target} overwrite removed', { target });
  const parts: string[] = [];
  const lower = (list: string[]) => t.list(list.map((name) => words(name).toLowerCase()));
  if (change.allow.added.length > 0) {
    parts.push(t('{target} can now {what}', { target, what: lower(change.allow.added) }));
  }
  if (change.deny.added.length > 0) {
    parts.push(t('{target} can no longer {what}', { target, what: lower(change.deny.added) }));
  }
  if (parts.length === 0) parts.push(t('{target} permissions changed', { target }));
  return parts.join(', ');
}

function settingName(key: string): string {
  return words(key)
    .replace(/ Ids?$/, '')
    .toLowerCase();
}

function twinRole(roles: readonly SnapshotRole[], id: string, name: string): SnapshotRole | null {
  return roles.find((role) => role.id === id) ?? roles.find((role) => role.name === name) ?? null;
}

function twinChannel(
  channels: readonly SnapshotChannel[],
  id: string,
  name: string,
): SnapshotChannel | null {
  return (
    channels.find((channel) => channel.id === id) ??
    channels.find((channel) => channel.name === name) ??
    null
  );
}

export function buildDiff(
  t: Translator,
  guildId: string,
  oldId: string,
  newId: string,
  older: SnapshotData,
  newer: SnapshotData,
): DiffView {
  const diff = diffSnapshots(older, newer);
  const items: DiffItem[] = [];
  const roleNames = new Map<string, string>();
  for (const role of [...older.roles, ...newer.roles]) roleNames.set(role.id, role.name);
  const target = (change: OverwriteChange) => {
    if (change.type === 'member') return t('A member');
    if (change.id === guildId) return '@everyone';
    return `@${roleNames.get(change.id) ?? t('deleted role')}`;
  };

  for (const role of diff.roles.added) {
    items.push({
      key: `role+${role.id}`,
      group: 'Roles',
      sign: '+',
      label: role.name,
      detail: t('added'),
      restore: null,
    });
  }
  for (const role of diff.roles.removed) {
    items.push({
      key: `role-${role.id}`,
      group: 'Roles',
      sign: '-',
      label: role.name,
      detail: t('deleted'),
      restore: { kind: 'role', id: role.id },
    });
  }
  for (const change of diff.roles.changed) {
    const renamed = change.changes.find((item) => item.field === 'name');
    const old = twinRole(older.roles, change.id, String(renamed?.before ?? change.name));
    const parts = [
      ...change.changes.map((item) => fieldText(t, item, false)).filter((text) => text !== null),
      ...(change.permissions ? permissionText(t, change.permissions) : []),
    ];
    items.push({
      key: `role~${change.id}`,
      group: 'Roles',
      sign: '~',
      label: change.name,
      detail: parts.join(', '),
      restore: old ? { kind: 'role', id: old.id } : null,
    });
  }

  for (const channel of diff.channels.added) {
    items.push({
      key: `channel+${channel.id}`,
      group: 'Channels',
      sign: '+',
      label: channelLabel(channel),
      detail: channel.type === CATEGORY ? t('category added') : t('added'),
      restore: null,
    });
  }
  for (const channel of diff.channels.removed) {
    items.push({
      key: `channel-${channel.id}`,
      group: 'Channels',
      sign: '-',
      label: channelLabel(channel),
      detail: channel.type === CATEGORY ? t('category deleted') : t('deleted'),
      restore: { kind: 'channel', id: channel.id },
    });
  }
  for (const change of diff.channels.changed) {
    const live = newer.channels.find((channel) => channel.id === change.id);
    const renamed = change.changes.find((item) => item.field === 'name');
    const old = twinChannel(older.channels, change.id, String(renamed?.before ?? change.name));
    const parts = [
      ...change.changes.map((item) => fieldText(t, item, true)).filter((text) => text !== null),
      ...change.overwrites.map((item) => overwriteText(t, item, target(item))),
    ];
    items.push({
      key: `channel~${change.id}`,
      group: 'Channels',
      sign: '~',
      label: live ? channelLabel(live) : change.name,
      detail: parts.join(', '),
      restore: old ? { kind: 'channel', id: old.id } : null,
    });
  }

  for (const change of diff.modules) {
    const parts: string[] = [];
    if (change.enabled) {
      parts.push(change.enabled.after ? t('turned on') : t('turned off'));
    }
    if (change.keys.length > 0 && change.keys.length <= 3) {
      parts.push(t('{names} changed', { names: t.list(change.keys.map(settingName)) }));
    } else if (change.keys.length > 3) {
      parts.push(t('{count} settings changed', { count: change.keys.length }));
    }
    const inOld = Object.hasOwn(older.modules, change.module);
    const name = moduleByKey(change.module)?.name;
    items.push({
      key: `module~${change.module}`,
      group: 'Maxwell settings',
      sign: inOld ? (Object.hasOwn(newer.modules, change.module) ? '~' : '-') : '+',
      label: name ? t.raw(name) : change.module,
      detail: parts.join(', '),
      restore: inOld && moduleByKey(change.module) ? { kind: 'module', id: change.module } : null,
    });
  }

  return { oldId, newId, items };
}

export async function compare(guildId: string, oldId: string, newId: string): Promise<DiffView> {
  const [older, newer, t] = await Promise.all([
    store().get(guildId, oldId),
    store().get(guildId, newId),
    getT(),
  ]);
  if (!older || !newer) return { oldId, newId, items: [] };
  return buildDiff(t, guildId, oldId, newId, older.data, newer.data);
}

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function importView(row: ImportRow): ImportView {
  const plan = (row.plan ?? {}) as {
    source?: { name?: unknown };
    roles?: unknown;
    channels?: unknown;
    skipped?: unknown;
  };
  const channels = Array.isArray(plan.channels)
    ? (plan.channels as { type?: unknown; overwrites?: unknown }[])
    : [];
  const result = (row.result ?? null) as {
    roles?: unknown;
    channels?: unknown;
    failed?: unknown;
  } | null;
  return {
    id: String(row.id),
    status: row.status,
    error: row.error,
    name: typeof plan.source?.name === 'string' ? plan.source.name : null,
    roles: count(plan.roles),
    categories: channels.filter((channel) => channel.type === CATEGORY).length,
    channels: channels.filter((channel) => channel.type !== CATEGORY).length,
    overwrites: channels.reduce((sum, channel) => sum + count(channel.overwrites), 0),
    skipped: count(plan.skipped),
    created: result
      ? {
          roles: count(result.roles),
          channels: count(result.channels),
          failed: count(result.failed),
        }
      : null,
  };
}

export async function latestImport(guildId: string): Promise<ImportView | null> {
  const [row] = await store().listImports(guildId, 1);
  if (row?.status !== 'previewed') return null;
  return importView(row);
}

export async function loadImport(guildId: string, id: string): Promise<ImportView | null> {
  const row = await store().getImport(guildId, id);
  return row ? importView(row) : null;
}
