import { z } from 'zod';
import { defineModule } from './types.js';

export const backupsConfig = z.object({
  daily: z.boolean().default(true),
  retentionDays: z.number().int().min(1).max(90).default(14),
  maxManual: z.number().int().min(1).max(50).default(10),
  includeModules: z.boolean().default(true),
  undoDeletions: z.boolean().default(true),
  snapshotBeforeRestore: z.boolean().default(true),
});

export type BackupsConfig = z.infer<typeof backupsConfig>;

export const permissionBits = {
  CreateInstantInvite: 0,
  KickMembers: 1,
  BanMembers: 2,
  Administrator: 3,
  ManageChannels: 4,
  ManageGuild: 5,
  AddReactions: 6,
  ViewAuditLog: 7,
  PrioritySpeaker: 8,
  Stream: 9,
  ViewChannel: 10,
  SendMessages: 11,
  SendTtsMessages: 12,
  ManageMessages: 13,
  EmbedLinks: 14,
  AttachFiles: 15,
  ReadMessageHistory: 16,
  MentionEveryone: 17,
  UseExternalEmojis: 18,
  Connect: 20,
  Speak: 21,
  MuteMembers: 22,
  DeafenMembers: 23,
  MoveMembers: 24,
  UseVad: 25,
  ChangeNickname: 26,
  ManageNicknames: 27,
  ManageRoles: 28,
  ManageWebhooks: 29,
  ManageExpressions: 30,
  UseExternalStickers: 37,
  ModerateMembers: 40,
  CreateExpressions: 43,
  PinMessages: 51,
  BypassSlowmode: 52,
  UpdateRtcRegion: 53,
  ViewChannelMembers: 54,
} as const;

export type PermissionName = keyof typeof permissionBits;

const bitEntries = Object.entries(permissionBits) as [PermissionName, number][];

export function permissionsFromBits(bits: string | null | undefined): PermissionName[] {
  let value: bigint;
  try {
    value = BigInt(bits ?? '0');
  } catch {
    return [];
  }
  return bitEntries.filter(([, bit]) => (value >> BigInt(bit)) & 1n).map(([name]) => name);
}

export function bitsFromPermissions(names: readonly string[]): string {
  let value = 0n;
  for (const name of names) {
    const bit = permissionBits[name as PermissionName];
    if (bit !== undefined) value |= 1n << BigInt(bit);
  }
  return value.toString();
}

export interface SnapshotOverwrite {
  id: string;
  type: 'role' | 'member';
  allow: string;
  deny: string;
}

export interface SnapshotRole {
  id: string;
  name: string;
  color: number;
  position: number;
  permissions: string;
  hoist: boolean | null;
  mentionable: boolean | null;
}

export interface SnapshotChannel {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
  position: number;
  topic: string | null;
  userLimit: number | null;
  nsfw: boolean | null;
  rateLimitPerUser?: number | null;
  overwrites: SnapshotOverwrite[] | null;
}

export interface SnapshotModule {
  enabled: boolean | null;
  config: Record<string, unknown>;
}

export const SNAPSHOT_VERSION = 2;

export interface SnapshotData {
  version: 1 | 2;
  roles: SnapshotRole[];
  channels: SnapshotChannel[];
  modules: Record<string, SnapshotModule>;
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface PermissionDelta {
  added: string[];
  removed: string[];
}

export interface RoleChange {
  id: string;
  name: string;
  changes: FieldChange[];
  permissions: PermissionDelta | null;
}

export interface OverwriteChange {
  id: string;
  type: 'role' | 'member';
  status: 'added' | 'removed' | 'changed';
  allow: PermissionDelta;
  deny: PermissionDelta;
}

export interface ChannelChange {
  id: string;
  name: string;
  changes: FieldChange[];
  overwrites: OverwriteChange[];
}

export interface ModuleChange {
  module: string;
  enabled: { before: boolean | null; after: boolean | null } | null;
  keys: string[];
}

export interface SnapshotDiff {
  roles: { added: SnapshotRole[]; removed: SnapshotRole[]; changed: RoleChange[] };
  channels: { added: SnapshotChannel[]; removed: SnapshotChannel[]; changed: ChannelChange[] };
  modules: ModuleChange[];
  total: number;
}

const bitNames = new Map<number, PermissionName>(bitEntries.map(([name, bit]) => [bit, name]));

export function permissionLabels(bits: string | null | undefined): string[] {
  let value: bigint;
  try {
    value = BigInt(bits ?? '0');
  } catch {
    return [];
  }
  const out: string[] = [];
  for (let bit = 0; value >> BigInt(bit) > 0n; bit++) {
    if (((value >> BigInt(bit)) & 1n) === 1n) out.push(bitNames.get(bit) ?? `bit ${bit}`);
  }
  return out;
}

export function permissionDelta(before: string, after: string): PermissionDelta {
  const was = new Set(permissionLabels(before));
  const now = new Set(permissionLabels(after));
  return {
    added: [...now].filter((name) => !was.has(name)),
    removed: [...was].filter((name) => !now.has(name)),
  };
}

function emptyDelta(delta: PermissionDelta): boolean {
  return delta.added.length === 0 && delta.removed.length === 0;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${stable(inner)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function pair<T extends { id: string }>(
  before: readonly T[],
  after: readonly T[],
  sameKind: (a: T, b: T) => boolean,
): { added: T[]; removed: T[]; pairs: [T, T][] } {
  const afterById = new Map(after.map((item) => [item.id, item]));
  const pairs: [T, T][] = [];
  const removed: T[] = [];
  const matched = new Set<string>();
  for (const item of before) {
    const twin = afterById.get(item.id);
    if (twin) {
      pairs.push([item, twin]);
      matched.add(twin.id);
    } else {
      removed.push(item);
    }
  }
  let added = after.filter((item) => !matched.has(item.id));
  const stillRemoved: T[] = [];
  for (const item of removed) {
    const candidates = added.filter((other) => sameKind(item, other));
    const twins = removed.filter((other) => sameKind(other, item));
    const twin = candidates[0];
    if (candidates.length === 1 && twins.length === 1 && twin) {
      pairs.push([item, twin]);
      added = added.filter((other) => other !== twin);
    } else {
      stillRemoved.push(item);
    }
  }
  return { added, removed: stillRemoved, pairs };
}

function fieldChanges<T extends object>(
  before: T,
  after: T,
  exact: readonly (keyof T & string)[],
  known: readonly (keyof T & string)[] = [],
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const field of exact) {
    const a = before[field] ?? null;
    const b = after[field] ?? null;
    if (a !== b) out.push({ field, before: a, after: b });
  }
  for (const field of known) {
    const a = before[field] ?? null;
    const b = after[field] ?? null;
    if (a !== null && b !== null && a !== b) out.push({ field, before: a, after: b });
  }
  return out;
}

function overwriteChanges(
  before: SnapshotOverwrite[] | null,
  after: SnapshotOverwrite[] | null,
  roleIds: Map<string, string>,
): OverwriteChange[] {
  if (before === null || after === null) return [];
  const translate = (overwrite: SnapshotOverwrite): SnapshotOverwrite =>
    overwrite.type === 'role'
      ? { ...overwrite, id: roleIds.get(overwrite.id) ?? overwrite.id }
      : overwrite;
  const was = new Map(before.map((o) => [`${o.type}:${translate(o).id}`, translate(o)]));
  const now = new Map(after.map((o) => [`${o.type}:${o.id}`, o]));
  const out: OverwriteChange[] = [];
  for (const [key, old] of was) {
    const next = now.get(key);
    if (!next) {
      out.push({
        id: old.id,
        type: old.type,
        status: 'removed',
        allow: permissionDelta(old.allow, '0'),
        deny: permissionDelta(old.deny, '0'),
      });
      continue;
    }
    const allow = permissionDelta(old.allow, next.allow);
    const deny = permissionDelta(old.deny, next.deny);
    if (!emptyDelta(allow) || !emptyDelta(deny)) {
      out.push({ id: next.id, type: next.type, status: 'changed', allow, deny });
    }
  }
  for (const [key, next] of now) {
    if (was.has(key)) continue;
    out.push({
      id: next.id,
      type: next.type,
      status: 'added',
      allow: permissionDelta('0', next.allow),
      deny: permissionDelta('0', next.deny),
    });
  }
  return out;
}

export function diffSnapshots(before: SnapshotData, after: SnapshotData): SnapshotDiff {
  const complete = before.version >= 2 && after.version >= 2;
  const roles = pair(before.roles, after.roles, (a, b) => a.name === b.name);
  const roleIds = new Map(roles.pairs.map(([a, b]) => [a.id, b.id]));
  const changedRoles: RoleChange[] = [];
  const roleExtras = ['hoist', 'mentionable'] as const;
  for (const [a, b] of roles.pairs) {
    const changes = complete
      ? fieldChanges(a, b, ['id', 'name', 'color', ...roleExtras])
      : fieldChanges(a, b, ['id', 'name', 'color'], roleExtras);
    const delta = permissionDelta(a.permissions, b.permissions);
    const permissions = emptyDelta(delta) ? null : delta;
    if (changes.length > 0 || permissions) {
      changedRoles.push({ id: b.id, name: b.name, changes, permissions });
    }
  }

  const channels = pair(
    before.channels,
    after.channels,
    (a, b) => a.name === b.name && a.type === b.type,
  );
  const channelIds = new Map(channels.pairs.map(([a, b]) => [a.id, b.id]));
  const changedChannels: ChannelChange[] = [];
  const channelExtras = ['topic', 'userLimit', 'nsfw', 'rateLimitPerUser'] as const;
  for (const [a, b] of channels.pairs) {
    const translated = {
      ...a,
      parentId: a.parentId === null ? null : (channelIds.get(a.parentId) ?? a.parentId),
    };
    const changes = complete
      ? fieldChanges(translated, b, ['id', 'name', 'type', 'parentId', ...channelExtras])
      : fieldChanges(translated, b, ['id', 'name', 'type', 'parentId'], channelExtras);
    const overwrites = overwriteChanges(a.overwrites, b.overwrites, roleIds);
    if (changes.length > 0 || overwrites.length > 0) {
      changedChannels.push({ id: b.id, name: b.name, changes, overwrites });
    }
  }

  const modules: ModuleChange[] = [];
  const keys = new Set([...Object.keys(before.modules), ...Object.keys(after.modules)]);
  for (const module of [...keys].sort()) {
    const a = before.modules[module] ?? { enabled: null, config: {} };
    const b = after.modules[module] ?? { enabled: null, config: {} };
    const enabled = a.enabled === b.enabled ? null : { before: a.enabled, after: b.enabled };
    const fields = new Set([...Object.keys(a.config), ...Object.keys(b.config)]);
    const changed = [...fields]
      .filter((field) => stable(a.config[field]) !== stable(b.config[field]))
      .sort();
    if (enabled || changed.length > 0) modules.push({ module, enabled, keys: changed });
  }

  const total =
    roles.added.length +
    roles.removed.length +
    changedRoles.length +
    channels.added.length +
    channels.removed.length +
    changedChannels.length +
    modules.length;

  return {
    roles: { added: roles.added, removed: roles.removed, changed: changedRoles },
    channels: { added: channels.added, removed: channels.removed, changed: changedChannels },
    modules,
    total,
  };
}

export const TEMPLATE_TITLE_MAX = 60;
export const TEMPLATE_DESCRIPTION_MAX = 300;
export const TEMPLATE_ROLE_LIMIT = 250;
export const TEMPLATE_CHANNEL_LIMIT = 500;
export const TEMPLATE_EVERYONE = 'everyone';
export const TEMPLATE_CATEGORY = 4;

const templateChannelTypes = new Set([0, 2, 4, 5, 15]);

export interface TemplateRole {
  key: string;
  name: string;
  color: number;
  permissions: string;
  hoist: boolean;
  mentionable: boolean;
}

export interface TemplateOverwrite {
  target: string;
  allow: string;
  deny: string;
}

export interface TemplateChannel {
  key: string;
  name: string;
  type: number;
  parentKey: string | null;
  topic: string | null;
  userLimit: number | null;
  nsfw: boolean;
  rateLimitPerUser: number;
  overwrites: TemplateOverwrite[];
}

export interface TemplateData {
  version: 1;
  everyone: string | null;
  roles: TemplateRole[];
  channels: TemplateChannel[];
}

function templateBits(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) return '0';
  return BigInt(value) >= 1n << 64n ? '0' : BigInt(value).toString();
}

function templateName(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.slice(0, 100) || fallback;
}

export function cleanTemplateTopic(
  topic: string | null | undefined,
  roles: ReadonlyMap<string, string>,
  channels: ReadonlyMap<string, string>,
): string | null {
  if (typeof topic !== 'string') return null;
  const text = topic
    .replace(/<(@[!&]?|#)(\d{1,21})>/g, (_, kind: string, id: string) => {
      if (kind === '@&') {
        const name = roles.get(id);
        return name ? `@${name}` : '';
      }
      if (kind === '#') {
        const name = channels.get(id);
        return name ? `#${name}` : '';
      }
      return '';
    })
    .replace(/\d{15,21}/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return text ? text.slice(0, 1024) : null;
}

export function sanitizeTemplate(
  guildId: string,
  data: SnapshotData,
  options: { skipRoles?: ReadonlySet<string> } = {},
): TemplateData {
  const skip = options.skipRoles ?? new Set<string>();
  const everyone = data.roles.find((role) => role.id === guildId) ?? null;
  const sourceRoles = data.roles
    .map((role, index) => ({ role, index }))
    .filter(({ role }) => role.id !== guildId && !skip.has(role.id))
    .sort((a, b) => b.role.position - a.role.position || a.index - b.index)
    .slice(0, TEMPLATE_ROLE_LIMIT)
    .map(({ role }) => role);
  const roleKeys = new Map(sourceRoles.map((role, index) => [role.id, `r${index + 1}`]));
  const roles: TemplateRole[] = sourceRoles.map((role) => ({
    key: roleKeys.get(role.id) ?? '',
    name: templateName(role.name, 'role'),
    color: Number.isSafeInteger(role.color) && role.color > 0 ? role.color & 0xffffff : 0,
    permissions: templateBits(role.permissions),
    hoist: role.hoist === true,
    mentionable: role.mentionable === true,
  }));

  const typed = data.channels
    .map((channel, index) => ({ channel, index }))
    .filter(({ channel }) => templateChannelTypes.has(channel.type))
    .sort((a, b) => a.channel.position - b.channel.position || a.index - b.index)
    .map(({ channel }) => channel);
  const ordered = [
    ...typed.filter((channel) => channel.type === TEMPLATE_CATEGORY),
    ...typed.filter((channel) => channel.type !== TEMPLATE_CATEGORY),
  ].slice(0, TEMPLATE_CHANNEL_LIMIT);
  const channelKeys = new Map(ordered.map((channel, index) => [channel.id, `c${index + 1}`]));
  const categories = new Set(
    ordered.filter((channel) => channel.type === TEMPLATE_CATEGORY).map((channel) => channel.id),
  );
  const roleNames = new Map(
    [...(everyone ? [everyone] : []), ...sourceRoles].map((role) => [role.id, role.name]),
  );
  const channelNames = new Map(ordered.map((channel) => [channel.id, channel.name]));

  const channels: TemplateChannel[] = ordered.map((channel) => {
    const overwrites: TemplateOverwrite[] = [];
    for (const overwrite of channel.overwrites ?? []) {
      if (overwrite.type !== 'role') continue;
      const target = overwrite.id === guildId ? TEMPLATE_EVERYONE : roleKeys.get(overwrite.id);
      if (!target) continue;
      overwrites.push({
        target,
        allow: templateBits(overwrite.allow),
        deny: templateBits(overwrite.deny),
      });
    }
    const voice = channel.type === 2;
    return {
      key: channelKeys.get(channel.id) ?? '',
      name: templateName(channel.name, 'channel'),
      type: channel.type,
      parentKey:
        channel.type !== TEMPLATE_CATEGORY && channel.parentId && categories.has(channel.parentId)
          ? (channelKeys.get(channel.parentId) ?? null)
          : null,
      topic: voice ? null : cleanTemplateTopic(channel.topic, roleNames, channelNames),
      userLimit:
        voice && typeof channel.userLimit === 'number' && channel.userLimit > 0
          ? Math.min(Math.floor(channel.userLimit), 99)
          : null,
      nsfw: channel.nsfw === true,
      rateLimitPerUser:
        typeof channel.rateLimitPerUser === 'number' && channel.rateLimitPerUser > 0
          ? Math.min(Math.floor(channel.rateLimitPerUser), 21_600)
          : 0,
      overwrites,
    };
  });

  return {
    version: 1,
    everyone: everyone ? templateBits(everyone.permissions) : null,
    roles,
    channels,
  };
}

export function isTemplateData(value: unknown): value is TemplateData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<TemplateData>;
  return data.version === 1 && Array.isArray(data.roles) && Array.isArray(data.channels);
}

export default defineModule({
  key: 'backups',
  name: 'Backups',
  description: 'Snapshots of roles, channels and settings.',
  group: 'order',
  pole: 'south',
  voteLocked: true,
  defaultEnabled: false,
  toggleable: true,
  config: backupsConfig,
  migrations: [
    {
      id: '1-snapshots',
      up: `
        create table backups_snapshots (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          kind text not null,
          label text,
          created_by bigint,
          role_count integer not null default 0,
          channel_count integer not null default 0,
          module_count integer not null default 0,
          data jsonb not null,
          created_at timestamptz not null default now()
        );

        create index backups_snapshots_guild on backups_snapshots (guild_id, created_at desc);
      `,
    },
    {
      id: '2-imports',
      up: `
        create table backups_imports (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          code text not null,
          status text not null default 'pending',
          plan jsonb,
          result jsonb,
          error text,
          created_by bigint,
          created_at timestamptz not null default now(),
          applied_at timestamptz
        );

        create index backups_imports_guild on backups_imports (guild_id, created_at desc);
      `,
    },
    {
      id: '3-numbers',
      up: `
        alter table backups_snapshots add column number integer;
        update backups_snapshots s set number = ranked.n
        from (
          select id, row_number() over (partition by guild_id order by id) as n from backups_snapshots
        ) ranked
        where ranked.id = s.id;
        alter table backups_snapshots alter column number set not null;
        create unique index backups_snapshots_number on backups_snapshots (guild_id, number);
      `,
    },
    {
      id: '4-templates',
      up: `
        create table backups_templates (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          title text not null,
          description text not null default '',
          guild_name text,
          role_count integer not null default 0,
          channel_count integer not null default 0,
          uses integer not null default 0,
          data jsonb not null,
          created_at timestamptz not null default now()
        );

        create index backups_templates_guild on backups_templates (guild_id);
        create index backups_templates_popular on backups_templates (uses desc, id desc);
      `,
    },
  ],
});
