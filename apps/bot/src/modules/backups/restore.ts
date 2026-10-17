import type {
  SnapshotChannel,
  SnapshotData,
  SnapshotModule,
  SnapshotOverwrite,
  SnapshotRole,
} from '@maxwell/core/modules/backups';
import {
  type ChannelInput,
  ChannelKind,
  type ChannelRef,
  type Overwrite,
  type Platform,
  type RoleEdit,
  type RoleInput,
  type RoleRef,
} from '../../platform/types.js';
import { toPlatformPermissions } from './permissions.js';
import { toSnapshotOverwrite } from './snapshot.js';

export type RestoreScope =
  | { kind: 'full' }
  | { kind: 'role'; id: string }
  | { kind: 'channel'; id: string }
  | { kind: 'modules'; modules?: string[] }
  | { kind: 'pick'; roles: string[]; channels: string[]; modules: string[] };

export type ChannelField =
  | 'name'
  | 'parentId'
  | 'topic'
  | 'userLimit'
  | 'rateLimitPerUser'
  | 'overwrites';

export type RoleField = 'name' | 'color' | 'permissions' | 'hoist' | 'mentionable' | 'position';

export interface ChannelState {
  id: string;
  name: string | null;
  parentId: string | null;
  topic: string | null;
  userLimit: number | null;
  rateLimitPerUser: number;
  overwrites: SnapshotOverwrite[];
}

export interface RoleState {
  id: string;
  name: string;
  color: number;
  permissions: string;
  hoist: boolean;
  mentionable: boolean;
  position: number;
}

export interface ChannelEdit {
  source: SnapshotChannel;
  current: ChannelState;
  fields: ChannelField[];
}

export interface RoleEditPlan {
  source: SnapshotRole;
  current: RoleState;
  fields: RoleField[];
}

export interface OverwriteRestore {
  channelId: string;
  overwrite: SnapshotOverwrite;
}

export interface Skipped {
  kind: 'role' | 'channel' | 'module';
  id: string;
  name: string;
  reason: 'exists' | 'everyone' | 'managed' | 'missing' | 'unknown';
}

export interface RestorePlan {
  roles: SnapshotRole[];
  roleEdits: RoleEditPlan[];
  categories: SnapshotChannel[];
  channels: SnapshotChannel[];
  edits: ChannelEdit[];
  overwrites: OverwriteRestore[];
  modules: string[];
  skipped: Skipped[];
}

export interface CurrentState {
  roles: readonly RoleRef[];
  channels: readonly ChannelRef[];
}

function emptyPlan(): RestorePlan {
  return {
    roles: [],
    roleEdits: [],
    categories: [],
    channels: [],
    edits: [],
    overwrites: [],
    modules: [],
    skipped: [],
  };
}

function sameBits(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return a === b;
  }
}

export function roleState(role: RoleRef): RoleState {
  return {
    id: role.id,
    name: role.name,
    color: role.color,
    permissions: /^\d+$/.test(role.permissions) ? role.permissions : '0',
    hoist: role.hoist,
    mentionable: role.mentionable,
    position: role.position,
  };
}

export function channelState(channel: ChannelRef): ChannelState {
  return {
    id: channel.id,
    name: channel.name,
    parentId: channel.parentId,
    topic: channel.topic,
    userLimit: channel.userLimit,
    rateLimitPerUser: channel.rateLimitPerUser,
    overwrites: channel.overwrites.map(toSnapshotOverwrite),
  };
}

function overwriteKey(overwrite: SnapshotOverwrite): string {
  return `${overwrite.type}:${overwrite.id}`;
}

export function sameOverwrites(
  a: readonly SnapshotOverwrite[],
  b: readonly SnapshotOverwrite[],
): boolean {
  if (a.length !== b.length) return false;
  const other = new Map(b.map((overwrite) => [overwriteKey(overwrite), overwrite]));
  return a.every((overwrite) => {
    const twin = other.get(overwriteKey(overwrite));
    return (
      twin !== undefined &&
      sameBits(twin.allow, overwrite.allow) &&
      sameBits(twin.deny, overwrite.deny)
    );
  });
}

function rankChanges(
  guildId: string,
  snapshot: readonly SnapshotRole[],
  live: ReadonlyMap<string, RoleRef>,
): Set<string> {
  const shared = snapshot.filter((role) => role.id !== guildId && live.has(role.id));
  const bySnapshot = [...shared]
    .sort((a, b) => b.position - a.position || a.id.localeCompare(b.id))
    .map((role) => role.id);
  const byLive = [...shared]
    .sort(
      (a, b) =>
        (live.get(b.id)?.position ?? 0) - (live.get(a.id)?.position ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .map((role) => role.id);
  return new Set(bySnapshot.filter((id, index) => byLive[index] !== id));
}

export function roleFields(
  source: SnapshotRole,
  live: RoleRef,
  everyone: boolean,
  moved: boolean,
): RoleField[] {
  const fields: RoleField[] = [];
  if (!sameBits(source.permissions, live.permissions)) fields.push('permissions');
  if (everyone) return fields;
  if (source.name && source.name !== live.name) fields.push('name');
  if (source.color !== live.color) fields.push('color');
  if (source.hoist !== null && source.hoist !== live.hoist) fields.push('hoist');
  if (source.mentionable !== null && source.mentionable !== live.mentionable) {
    fields.push('mentionable');
  }
  if (moved) fields.push('position');
  return fields;
}

export function channelFields(
  source: SnapshotChannel,
  live: ChannelRef,
  complete: boolean,
  parentKnown: boolean,
  wanted: readonly SnapshotOverwrite[] | null,
): ChannelField[] {
  const fields: ChannelField[] = [];
  if ((live.name ?? '') !== source.name) fields.push('name');
  if (source.parentId !== live.parentId && (source.parentId === null || parentKnown)) {
    fields.push('parentId');
  }
  if (complete || source.topic !== null) {
    if ((source.topic ?? '') !== (live.topic ?? '')) fields.push('topic');
  }
  if (complete || source.userLimit !== null) {
    if ((source.userLimit ?? 0) !== (live.userLimit ?? 0)) fields.push('userLimit');
  }
  if (typeof source.rateLimitPerUser === 'number') {
    if (source.rateLimitPerUser !== (live.rateLimitPerUser ?? 0)) fields.push('rateLimitPerUser');
  }
  if (wanted !== null && !sameOverwrites(wanted, live.overwrites.map(toSnapshotOverwrite))) {
    fields.push('overwrites');
  }
  return fields;
}

export function planRestore(
  guildId: string,
  snapshot: SnapshotData,
  current: CurrentState,
  scope: RestoreScope,
  knownModules: (key: string) => boolean = () => true,
): RestorePlan {
  const plan = emptyPlan();
  const complete = snapshot.version >= 2;
  const liveRoles = new Map(current.roles.map((role) => [role.id, role]));
  const channels = new Map(current.channels.map((channel) => [channel.id, channel]));
  const snapshotChannels = new Map(snapshot.channels.map((channel) => [channel.id, channel]));
  const moved = rankChanges(guildId, snapshot.roles, liveRoles);

  const addRole = (role: SnapshotRole) => {
    const live = liveRoles.get(role.id);
    if (role.id === guildId) {
      const fields = live ? roleFields(role, live, true, false) : [];
      if (live && fields.length > 0) {
        plan.roleEdits.push({ source: role, current: roleState(live), fields });
      } else {
        plan.skipped.push({ kind: 'role', id: role.id, name: role.name, reason: 'everyone' });
      }
      return;
    }
    if (live) {
      if (live.managed) {
        plan.skipped.push({ kind: 'role', id: role.id, name: role.name, reason: 'managed' });
        return;
      }
      const fields = roleFields(role, live, false, moved.has(role.id));
      if (fields.length > 0) {
        plan.roleEdits.push({ source: role, current: roleState(live), fields });
      } else {
        plan.skipped.push({ kind: 'role', id: role.id, name: role.name, reason: 'exists' });
      }
      return;
    }
    plan.roles.push(role);
  };

  const reachable = (overwrite: SnapshotOverwrite): boolean =>
    overwrite.type === 'member' ||
    overwrite.id === guildId ||
    liveRoles.has(overwrite.id) ||
    plan.roles.some((role) => role.id === overwrite.id);

  const addChannel = (channel: SnapshotChannel) => {
    const live = channels.get(channel.id);
    if (live) {
      const parentKnown =
        channel.parentId !== null &&
        (channels.has(channel.parentId) || snapshotChannels.has(channel.parentId));
      const wanted = channel.overwrites ? channel.overwrites.filter(reachable) : null;
      const fields = channelFields(channel, live, complete, parentKnown, wanted);
      if (fields.length > 0) {
        plan.edits.push({ source: channel, current: channelState(live), fields });
      }
      return;
    }
    if (channel.type === ChannelKind.Category) {
      if (!plan.categories.some((item) => item.id === channel.id)) plan.categories.push(channel);
    } else if (!plan.channels.some((item) => item.id === channel.id)) {
      plan.channels.push(channel);
    }
  };

  const pickRole = (id: string) => {
    const role = snapshot.roles.find((item) => item.id === id);
    if (role) addRole(role);
    else plan.skipped.push({ kind: 'role', id, name: id, reason: 'missing' });
  };

  const pickChannel = (id: string) => {
    const channel = snapshotChannels.get(id);
    if (!channel) {
      plan.skipped.push({ kind: 'channel', id, name: id, reason: 'missing' });
      return;
    }
    const parent = channel.parentId ? snapshotChannels.get(channel.parentId) : undefined;
    if (parent && !channels.has(parent.id)) addChannel(parent);
    addChannel(channel);
  };

  if (scope.kind === 'full') {
    for (const role of snapshot.roles) addRole(role);
    for (const channel of snapshot.channels) addChannel(channel);
  } else if (scope.kind === 'role') {
    pickRole(scope.id);
  } else if (scope.kind === 'channel') {
    pickChannel(scope.id);
  } else if (scope.kind === 'pick') {
    for (const id of scope.roles) pickRole(id);
    for (const id of scope.channels) pickChannel(id);
  }

  const pickedModules = scope.kind === 'pick' && scope.modules.length > 0;
  if (scope.kind === 'full' || scope.kind === 'modules' || pickedModules) {
    const wanted =
      scope.kind === 'pick'
        ? scope.modules
        : scope.kind === 'modules' && scope.modules?.length
          ? scope.modules
          : null;
    for (const key of Object.keys(snapshot.modules).sort()) {
      if (wanted && !wanted.includes(key)) continue;
      if (!knownModules(key)) {
        plan.skipped.push({ kind: 'module', id: key, name: key, reason: 'unknown' });
        continue;
      }
      plan.modules.push(key);
    }
    for (const key of wanted ?? []) {
      if (!(key in snapshot.modules)) {
        plan.skipped.push({ kind: 'module', id: key, name: key, reason: 'missing' });
      }
    }
  }

  plan.roles.sort((a, b) => b.position - a.position);
  plan.roleEdits.sort((a, b) => b.source.position - a.source.position);
  plan.categories.sort((a, b) => a.position - b.position);
  plan.channels.sort((a, b) => a.position - b.position);

  const recreated = new Set(plan.roles.map((role) => role.id));
  const replaced = new Set(
    plan.edits.filter((edit) => edit.fields.includes('overwrites')).map((edit) => edit.source.id),
  );
  if (recreated.size > 0) {
    for (const channel of snapshot.channels) {
      if (!channels.has(channel.id) || !channel.overwrites || replaced.has(channel.id)) continue;
      for (const overwrite of channel.overwrites) {
        if (overwrite.type === 'role' && recreated.has(overwrite.id)) {
          plan.overwrites.push({ channelId: channel.id, overwrite });
        }
      }
    }
  }
  return plan;
}

export function toOverwrite(id: string, overwrite: SnapshotOverwrite): Overwrite {
  return {
    id,
    type: overwrite.type,
    allow: toPlatformPermissions(overwrite.allow),
    deny: toPlatformPermissions(overwrite.deny),
    allowBits: overwrite.allow,
    denyBits: overwrite.deny,
  };
}

export function mapOverwrites(
  guildId: string,
  overwrites: readonly SnapshotOverwrite[] | null,
  roleMap: ReadonlyMap<string, string>,
  liveRoles: ReadonlySet<string>,
): Overwrite[] | undefined {
  if (!overwrites) return undefined;
  const out: Overwrite[] = [];
  for (const overwrite of overwrites) {
    let id = overwrite.id;
    if (overwrite.type === 'role' && id !== guildId) {
      const mapped = roleMap.get(id);
      if (mapped) id = mapped;
      else if (!liveRoles.has(id)) continue;
    }
    out.push(toOverwrite(id, overwrite));
  }
  return out;
}

export function roleInput(role: SnapshotRole): RoleInput {
  return {
    name: role.name.slice(0, 100) || 'role',
    color: role.color,
    permissions: toPlatformPermissions(role.permissions),
    permissionBits: role.permissions,
    hoist: role.hoist ?? false,
    mentionable: role.mentionable ?? false,
  };
}

export function roleEditInput(source: RoleState | SnapshotRole, fields: readonly RoleField[]) {
  const edit: RoleEdit = {};
  for (const field of fields) {
    switch (field) {
      case 'name':
        edit.name = source.name.slice(0, 100) || 'role';
        break;
      case 'color':
        edit.color = source.color;
        break;
      case 'permissions':
        edit.permissionBits = source.permissions;
        break;
      case 'hoist':
        edit.hoist = source.hoist ?? false;
        break;
      case 'mentionable':
        edit.mentionable = source.mentionable ?? false;
        break;
      case 'position':
        edit.position = source.position;
        break;
    }
  }
  return edit;
}

export type ChannelPatch = Partial<ChannelInput> & { rateLimitPerUser?: number };

export interface Created {
  from: string;
  id: string;
  name: string;
}

export interface RoleUndo {
  state: RoleState;
  fields: RoleField[];
}

export interface ChannelUndo {
  state: ChannelState;
  fields: ChannelField[];
}

export interface RestoreResult {
  roles: Created[];
  roleEdits: RoleUndo[];
  channels: Created[];
  edits: ChannelUndo[];
  overwrites: number;
  modules: string[];
  previousModules: Record<string, SnapshotModule>;
  failed: { kind: 'role' | 'roleEdit' | 'channel' | 'edit' | 'overwrite'; name: string }[];
}

export interface RestoreDeps {
  platform: Platform;
  readModules(guildId: string): Promise<Record<string, SnapshotModule>>;
  writeModules(guildId: string, states: Record<string, SnapshotModule>): Promise<void>;
  onError(error: unknown, what: string): void;
}

export async function executeRestore(
  deps: RestoreDeps,
  guildId: string,
  snapshot: SnapshotData,
  plan: RestorePlan,
  reason: string,
): Promise<RestoreResult> {
  const { platform } = deps;
  const result: RestoreResult = {
    roles: [],
    roleEdits: [],
    channels: [],
    edits: [],
    overwrites: 0,
    modules: [],
    previousModules: {},
    failed: [],
  };
  const roleMap = new Map<string, string>();
  const channelMap = new Map<string, string>();
  const liveRoles = new Set((await platform.roles(guildId)).map((role) => role.id));
  const liveChannels = new Set((await platform.channels(guildId)).map((channel) => channel.id));

  for (const role of plan.roles) {
    try {
      const id = await platform.createRole(guildId, roleInput(role), reason);
      roleMap.set(role.id, id);
      liveRoles.add(id);
      result.roles.push({ from: role.id, id, name: role.name });
    } catch (error) {
      deps.onError(error, 'role');
      result.failed.push({ kind: 'role', name: role.name });
    }
  }

  for (const edit of plan.roleEdits) {
    try {
      await platform.editRole(
        guildId,
        edit.current.id,
        roleEditInput(edit.source, edit.fields),
        reason,
      );
      result.roleEdits.push({ state: edit.current, fields: edit.fields });
    } catch (error) {
      deps.onError(error, 'roleEdit');
      result.failed.push({ kind: 'roleEdit', name: edit.source.name });
    }
  }

  const parentFor = (parentId: string | null): string | null => {
    if (!parentId) return null;
    const mapped = channelMap.get(parentId);
    if (mapped) return mapped;
    return liveChannels.has(parentId) ? parentId : null;
  };

  for (const channel of [...plan.categories, ...plan.channels]) {
    const input: ChannelInput = {
      name: channel.name.slice(0, 100) || 'channel',
      type: channel.type,
      parentId: channel.type === ChannelKind.Category ? null : parentFor(channel.parentId),
      topic: channel.topic ?? undefined,
      userLimit: channel.userLimit ?? undefined,
      overwrites: mapOverwrites(guildId, channel.overwrites, roleMap, liveRoles),
    };
    let id: string;
    try {
      id = await platform.createChannel(guildId, input, reason);
      channelMap.set(channel.id, id);
      liveChannels.add(id);
      result.channels.push({ from: channel.id, id, name: channel.name });
    } catch (error) {
      deps.onError(error, 'channel');
      result.failed.push({ kind: 'channel', name: channel.name });
      continue;
    }
    if (channel.rateLimitPerUser) {
      await platform
        .editChannel(id, { rateLimitPerUser: channel.rateLimitPerUser }, reason)
        .catch((error) => deps.onError(error, 'slowmode'));
    }
  }

  for (const edit of plan.edits) {
    const source = edit.source;
    const patch: ChannelPatch = {};
    for (const field of edit.fields) {
      switch (field) {
        case 'name':
          patch.name = source.name.slice(0, 100) || 'channel';
          break;
        case 'parentId':
          patch.parentId = parentFor(source.parentId);
          break;
        case 'topic':
          patch.topic = source.topic ?? '';
          break;
        case 'userLimit':
          patch.userLimit = source.userLimit ?? 0;
          break;
        case 'rateLimitPerUser':
          patch.rateLimitPerUser = source.rateLimitPerUser ?? 0;
          break;
        case 'overwrites':
          patch.overwrites = mapOverwrites(guildId, source.overwrites, roleMap, liveRoles) ?? [];
          break;
      }
    }
    try {
      await platform.editChannel(edit.current.id, patch, reason);
      result.edits.push({ state: edit.current, fields: edit.fields });
    } catch (error) {
      deps.onError(error, 'edit');
      result.failed.push({ kind: 'edit', name: source.name });
    }
  }

  for (const { channelId, overwrite } of plan.overwrites) {
    const id = roleMap.get(overwrite.id);
    if (!id) continue;
    try {
      await platform.setOverwrite(channelId, toOverwrite(id, overwrite), reason);
      result.overwrites++;
    } catch (error) {
      deps.onError(error, 'overwrite');
      result.failed.push({ kind: 'overwrite', name: channelId });
    }
  }

  if (plan.modules.length > 0) {
    const before = await deps.readModules(guildId);
    const chosen: Record<string, SnapshotModule> = {};
    for (const key of plan.modules) {
      const state = snapshot.modules[key];
      if (!state) continue;
      chosen[key] = state;
      result.previousModules[key] = before[key] ?? { enabled: null, config: {} };
    }
    await deps.writeModules(guildId, chosen);
    result.modules = Object.keys(chosen);
  }

  return result;
}

export function undoPayload(result: RestoreResult): Record<string, unknown> {
  return {
    roles: result.roles.map((role) => role.id),
    channels: result.channels.map((channel) => channel.id),
    roleEdits: result.roleEdits,
    edits: result.edits,
    modules: result.previousModules,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function overwriteList(value: unknown): SnapshotOverwrite[] | null {
  if (!Array.isArray(value)) return null;
  const out: SnapshotOverwrite[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    out.push({
      id: item.id,
      type: item.type === 'member' ? 'member' : 'role',
      allow: typeof item.allow === 'string' ? item.allow : '0',
      deny: typeof item.deny === 'string' ? item.deny : '0',
    });
  }
  return out;
}

export function channelUndoPatch(entry: unknown): { id: string; patch: ChannelPatch } | null {
  if (!isRecord(entry)) return null;
  const legacy = typeof entry.id === 'string';
  const state = legacy ? entry : isRecord(entry.state) ? entry.state : null;
  if (!state || typeof state.id !== 'string') return null;
  const fields: string[] = legacy
    ? ['name', 'parentId']
    : Array.isArray(entry.fields)
      ? entry.fields.filter((field): field is string => typeof field === 'string')
      : [];
  const patch: ChannelPatch = {};
  for (const field of fields) {
    switch (field) {
      case 'name':
        if (typeof state.name === 'string' && state.name) patch.name = state.name;
        break;
      case 'parentId':
        patch.parentId = typeof state.parentId === 'string' ? state.parentId : null;
        break;
      case 'topic':
        patch.topic = typeof state.topic === 'string' ? state.topic : '';
        break;
      case 'userLimit':
        patch.userLimit = typeof state.userLimit === 'number' ? state.userLimit : 0;
        break;
      case 'rateLimitPerUser':
        patch.rateLimitPerUser =
          typeof state.rateLimitPerUser === 'number' ? state.rateLimitPerUser : 0;
        break;
      case 'overwrites': {
        const list = overwriteList(state.overwrites);
        if (list) patch.overwrites = list.map((overwrite) => toOverwrite(overwrite.id, overwrite));
        break;
      }
    }
  }
  return { id: state.id, patch };
}

export function roleUndoEdit(entry: unknown): { id: string; edit: RoleEdit } | null {
  if (!isRecord(entry) || !isRecord(entry.state) || !Array.isArray(entry.fields)) return null;
  const state = entry.state;
  if (typeof state.id !== 'string') return null;
  const fields = entry.fields.filter((field): field is RoleField =>
    ['name', 'color', 'permissions', 'hoist', 'mentionable', 'position'].includes(field as string),
  );
  const restored: RoleState = {
    id: state.id,
    name: typeof state.name === 'string' ? state.name : '',
    color: typeof state.color === 'number' ? state.color : 0,
    permissions: typeof state.permissions === 'string' ? state.permissions : '0',
    hoist: state.hoist === true,
    mentionable: state.mentionable === true,
    position: typeof state.position === 'number' ? state.position : 0,
  };
  const usable = fields.filter((field) => field !== 'name' || restored.name.length > 0);
  if (usable.length === 0) return null;
  return { id: state.id, edit: roleEditInput(restored, usable) };
}
