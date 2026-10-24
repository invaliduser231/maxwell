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

function sentence(list: readonly string[]): string {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

function permissionText(delta: PermissionDelta): string[] {
  const out: string[] = [];
  if (delta.added.length > 0) out.push(`${sentence(delta.added.map(words))} added`);
  if (delta.removed.length > 0) out.push(`${sentence(delta.removed.map(words))} removed`);
  return out;
}

function channelLabel(channel: { name: string; type: number }): string {
  return TEXT_TYPES.has(channel.type) ? `#${channel.name}` : channel.name;
}

function slowmode(value: unknown): string {
  return typeof value === 'number' && value > 0 ? `${value} seconds` : 'off';
}

function fieldText(change: FieldChange, channel: boolean): string | null {
  switch (change.field) {
    case 'id':
      return 'deleted and created again';
    case 'name':
      return `renamed from ${channel ? '#' : ''}${String(change.before)}`;
    case 'color':
      return 'color changed';
    case 'hoist':
      return change.after ? 'now shown separately' : 'no longer shown separately';
    case 'mentionable':
      return change.after ? 'now mentionable' : 'no longer mentionable';
    case 'parentId':
      return 'moved to another category';
    case 'type':
      return 'type changed';
    case 'topic':
      return 'topic changed';
    case 'userLimit':
      return `user limit ${change.before ?? 'none'} to ${change.after ?? 'none'}`;
    case 'nsfw':
      return change.after ? 'marked NSFW' : 'no longer NSFW';
    case 'rateLimitPerUser':
      return `slowmode ${slowmode(change.before)} to ${slowmode(change.after)}`;
    default:
      return null;
  }
}

function overwriteText(change: OverwriteChange, target: string): string {
  if (change.status === 'added') return `${target} overwrite added`;
  if (change.status === 'removed') return `${target} overwrite removed`;
  const parts: string[] = [];
  const lower = (list: string[]) => sentence(list.map((name) => words(name).toLowerCase()));
  if (change.allow.added.length > 0) parts.push(`${target} can now ${lower(change.allow.added)}`);
  if (change.deny.added.length > 0) {
    parts.push(`${target} can no longer ${lower(change.deny.added)}`);
  }
  if (parts.length === 0) parts.push(`${target} permissions changed`);
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
    if (change.type === 'member') return 'A member';
    if (change.id === guildId) return '@everyone';
    return `@${roleNames.get(change.id) ?? 'deleted role'}`;
  };

  for (const role of diff.roles.added) {
    items.push({
      key: `role+${role.id}`,
      group: 'Roles',
      sign: '+',
      label: role.name,
      detail: 'added',
      restore: null,
    });
  }
  for (const role of diff.roles.removed) {
    items.push({
      key: `role-${role.id}`,
      group: 'Roles',
      sign: '-',
      label: role.name,
      detail: 'deleted',
      restore: { kind: 'role', id: role.id },
    });
  }
  for (const change of diff.roles.changed) {
    const renamed = change.changes.find((item) => item.field === 'name');
    const old = twinRole(older.roles, change.id, String(renamed?.before ?? change.name));
    const parts = [
      ...change.changes.map((item) => fieldText(item, false)).filter((text) => text !== null),
      ...(change.permissions ? permissionText(change.permissions) : []),
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
      detail: channel.type === CATEGORY ? 'category added' : 'added',
      restore: null,
    });
  }
  for (const channel of diff.channels.removed) {
    items.push({
      key: `channel-${channel.id}`,
      group: 'Channels',
      sign: '-',
      label: channelLabel(channel),
      detail: channel.type === CATEGORY ? 'category deleted' : 'deleted',
      restore: { kind: 'channel', id: channel.id },
    });
  }
  for (const change of diff.channels.changed) {
    const live = newer.channels.find((channel) => channel.id === change.id);
    const renamed = change.changes.find((item) => item.field === 'name');
    const old = twinChannel(older.channels, change.id, String(renamed?.before ?? change.name));
    const parts = [
      ...change.changes.map((item) => fieldText(item, true)).filter((text) => text !== null),
      ...change.overwrites.map((item) => overwriteText(item, target(item))),
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
      parts.push(change.enabled.after ? 'turned on' : 'turned off');
    }
    if (change.keys.length > 0 && change.keys.length <= 3) {
      parts.push(`${sentence(change.keys.map(settingName))} changed`);
    } else if (change.keys.length > 3) {
      parts.push(`${change.keys.length} settings changed`);
    }
    const inOld = Object.hasOwn(older.modules, change.module);
    items.push({
      key: `module~${change.module}`,
      group: 'Maxwell settings',
      sign: inOld ? (Object.hasOwn(newer.modules, change.module) ? '~' : '-') : '+',
      label: moduleByKey(change.module)?.name ?? change.module,
      detail: parts.join(', '),
      restore: inOld && moduleByKey(change.module) ? { kind: 'module', id: change.module } : null,
    });
  }

  return { oldId, newId, items };
}

export async function compare(guildId: string, oldId: string, newId: string): Promise<DiffView> {
  const [older, newer] = await Promise.all([
    store().get(guildId, oldId),
    store().get(guildId, newId),
  ]);
  if (!older || !newer) return { oldId, newId, items: [] };
  return buildDiff(guildId, oldId, newId, older.data, newer.data);
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
