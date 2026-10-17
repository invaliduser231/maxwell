import {
  SNAPSHOT_VERSION,
  type SnapshotChannel,
  type SnapshotData,
  type SnapshotModule,
  type SnapshotOverwrite,
  type SnapshotRole,
} from '@maxwell/core/modules/backups';
import type { ChannelRef, Platform, RawOverwrite, RoleRef } from '../../platform/types.js';

function bitString(value: unknown): string {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : '0';
}

export function toSnapshotOverwrite(overwrite: RawOverwrite): SnapshotOverwrite {
  return {
    id: overwrite.id,
    type: overwrite.type === 'member' ? 'member' : 'role',
    allow: bitString(overwrite.allow),
    deny: bitString(overwrite.deny),
  };
}

export function toSnapshotRole(role: RoleRef): SnapshotRole {
  return {
    id: role.id,
    name: role.name,
    color: role.color,
    position: role.position,
    permissions: bitString(role.permissions),
    hoist: typeof role.hoist === 'boolean' ? role.hoist : null,
    mentionable: typeof role.mentionable === 'boolean' ? role.mentionable : null,
  };
}

export function toSnapshotChannel(channel: ChannelRef): SnapshotChannel {
  return {
    id: channel.id,
    name: channel.name ?? '',
    type: channel.type,
    parentId: channel.parentId,
    position: channel.position,
    topic: typeof channel.topic === 'string' && channel.topic.length > 0 ? channel.topic : null,
    userLimit:
      typeof channel.userLimit === 'number' && channel.userLimit > 0 ? channel.userLimit : null,
    nsfw: typeof channel.nsfw === 'boolean' ? channel.nsfw : null,
    rateLimitPerUser:
      typeof channel.rateLimitPerUser === 'number' ? Math.max(channel.rateLimitPerUser, 0) : null,
    overwrites: Array.isArray(channel.overwrites)
      ? channel.overwrites.map(toSnapshotOverwrite)
      : null,
  };
}

export function buildSnapshot(
  roles: readonly RoleRef[],
  channels: readonly ChannelRef[],
  modules: Record<string, SnapshotModule>,
): SnapshotData {
  return {
    version: SNAPSHOT_VERSION,
    roles: [...roles].map(toSnapshotRole).sort((a, b) => b.position - a.position),
    channels: [...channels]
      .map(toSnapshotChannel)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
    modules,
  };
}

export async function capture(
  platform: Platform,
  guildId: string,
  modules: () => Promise<Record<string, SnapshotModule>>,
): Promise<SnapshotData> {
  const [roles, channels, states] = await Promise.all([
    platform.roles(guildId),
    platform.channels(guildId),
    modules(),
  ]);
  return buildSnapshot(roles, channels, states);
}
