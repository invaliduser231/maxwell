import { PermissionFlags } from '@fluxerjs/core';
import {
  bitsFromPermissions,
  diffSnapshots,
  permissionBits,
  permissionDelta,
  permissionsFromBits,
  type SnapshotChannel,
  type SnapshotData,
  type SnapshotRole,
} from '@maxwell/core/modules/backups';
import { describe, expect, it } from 'vitest';
import {
  droppedPermissions,
  toPlatformPermissions,
} from '../../src/modules/backups/permissions.js';

function role(
  id: string,
  name: string,
  permissions: string[] = [],
  extra: Partial<SnapshotRole> = {},
): SnapshotRole {
  return {
    id,
    name,
    color: 0,
    position: 1,
    permissions: bitsFromPermissions(permissions),
    hoist: false,
    mentionable: false,
    ...extra,
  };
}

function channel(id: string, name: string, extra: Partial<SnapshotChannel> = {}): SnapshotChannel {
  return {
    id,
    name,
    type: 0,
    parentId: null,
    position: 0,
    topic: null,
    userLimit: null,
    nsfw: null,
    overwrites: null,
    ...extra,
  };
}

function snapshot(partial: Partial<SnapshotData>): SnapshotData {
  return { version: 1, roles: [], channels: [], modules: {}, ...partial };
}

describe('permission bits', () => {
  it('matches the Fluxer permission flags', () => {
    for (const [name, bit] of Object.entries(permissionBits)) {
      expect(PermissionFlags[name as keyof typeof PermissionFlags]).toBe(1n << BigInt(bit));
    }
  });

  it('round trips names and bits', () => {
    const bits = bitsFromPermissions(['ViewChannel', 'ModerateMembers', 'Nope']);
    expect(bits).toBe(String((1n << 10n) | (1n << 40n)));
    expect(permissionsFromBits(bits)).toEqual(['ViewChannel', 'ModerateMembers']);
    expect(permissionsFromBits('garbage')).toEqual([]);
  });

  it('keeps only platform permissions and reports the rest', () => {
    const bits = String((1n << 10n) | (1n << 21n) | (1n << 31n));
    expect(toPlatformPermissions(bits)).toEqual(['ViewChannel']);
    expect(droppedPermissions(bits)).toEqual(['Speak', 'bit 31']);
  });

  it('lists added and removed permissions', () => {
    expect(
      permissionDelta(
        bitsFromPermissions(['ViewChannel', 'SendMessages']),
        bitsFromPermissions(['ViewChannel', 'BanMembers']),
      ),
    ).toEqual({ added: ['BanMembers'], removed: ['SendMessages'] });
  });
});

describe('diffSnapshots', () => {
  it('reports nothing for identical snapshots', () => {
    const data = snapshot({
      roles: [role('1', 'Mod', ['BanMembers'])],
      channels: [channel('10', 'general')],
      modules: { invites: { enabled: true, config: { logChannelId: '10' } } },
    });
    const diff = diffSnapshots(data, structuredClone(data));
    expect(diff.total).toBe(0);
    expect(diff.roles).toEqual({ added: [], removed: [], changed: [] });
  });

  it('finds added, removed and changed roles', () => {
    const before = snapshot({
      roles: [role('1', 'Mod', ['BanMembers']), role('2', 'Old'), role('4', 'Same')],
    });
    const after = snapshot({
      roles: [
        role('1', 'Moderator', ['BanMembers', 'KickMembers'], { color: 0xff0000 }),
        role('3', 'New'),
        role('4', 'Same', [], { position: 9 }),
      ],
    });
    const diff = diffSnapshots(before, after);
    expect(diff.roles.added.map((r) => r.name)).toEqual(['New']);
    expect(diff.roles.removed.map((r) => r.name)).toEqual(['Old']);
    expect(diff.roles.changed).toEqual([
      {
        id: '1',
        name: 'Moderator',
        changes: [
          { field: 'name', before: 'Mod', after: 'Moderator' },
          { field: 'color', before: 0, after: 0xff0000 },
        ],
        permissions: { added: ['KickMembers'], removed: [] },
      },
    ]);
    expect(diff.total).toBe(3);
  });

  it('pairs a recreated role by name instead of reporting remove and add', () => {
    const before = snapshot({ roles: [role('1', 'Helper', ['ManageMessages'])] });
    const after = snapshot({ roles: [role('7', 'Helper', ['ManageMessages'])] });
    const diff = diffSnapshots(before, after);
    expect(diff.roles.added).toEqual([]);
    expect(diff.roles.removed).toEqual([]);
    expect(diff.roles.changed[0]?.changes).toEqual([{ field: 'id', before: '1', after: '7' }]);
  });

  it('does not pair when names are ambiguous', () => {
    const before = snapshot({ roles: [role('1', 'Twin'), role('2', 'Twin')] });
    const after = snapshot({ roles: [role('3', 'Twin')] });
    const diff = diffSnapshots(before, after);
    expect(diff.roles.removed).toHaveLength(2);
    expect(diff.roles.added).toHaveLength(1);
  });

  it('ignores fields one side did not capture', () => {
    const before = snapshot({
      roles: [role('1', 'A', [], { hoist: null })],
      channels: [channel('5', 'x', { topic: null })],
    });
    const after = snapshot({
      roles: [role('1', 'A', [], { hoist: true })],
      channels: [channel('5', 'x', { topic: 'hi' })],
    });
    expect(diffSnapshots(before, after).total).toBe(0);
  });

  it('compares every field once both snapshots captured them', () => {
    const before = snapshot({
      version: 2,
      roles: [role('1', 'A', [], { hoist: true })],
      channels: [channel('5', 'x', { topic: 'hi', nsfw: false, rateLimitPerUser: 0 })],
    });
    const after = snapshot({
      version: 2,
      roles: [role('1', 'A', [], { hoist: false })],
      channels: [channel('5', 'x', { topic: null, nsfw: true, rateLimitPerUser: 30 })],
    });
    const diff = diffSnapshots(before, after);
    expect(diff.roles.changed[0]?.changes).toEqual([
      { field: 'hoist', before: true, after: false },
    ]);
    expect(diff.channels.changed[0]?.changes).toEqual([
      { field: 'topic', before: 'hi', after: null },
      { field: 'nsfw', before: false, after: true },
      { field: 'rateLimitPerUser', before: 0, after: 30 },
    ]);
  });

  it('reports overwrite bits that have no name', () => {
    const odd = String(1n << 60n);
    const before = snapshot({
      channels: [
        channel('5', 'x', { overwrites: [{ id: '1', type: 'role', allow: '0', deny: '0' }] }),
      ],
    });
    const after = snapshot({
      channels: [
        channel('5', 'x', { overwrites: [{ id: '1', type: 'role', allow: odd, deny: '0' }] }),
      ],
    });
    expect(diffSnapshots(before, after).channels.changed[0]?.overwrites[0]?.allow).toEqual({
      added: ['bit 60'],
      removed: [],
    });
  });

  it('follows channels into a recreated category', () => {
    const before = snapshot({
      channels: [
        channel('100', 'Text', { type: 4 }),
        channel('101', 'general', { parentId: '100' }),
      ],
    });
    const after = snapshot({
      channels: [
        channel('200', 'Text', { type: 4 }),
        channel('101', 'general', { parentId: '200' }),
      ],
    });
    const diff = diffSnapshots(before, after);
    const general = diff.channels.changed.find((c) => c.id === '101');
    expect(general).toBeUndefined();
    expect(diff.channels.changed[0]?.changes).toEqual([
      { field: 'id', before: '100', after: '200' },
    ]);
  });

  it('reports moved and renamed channels', () => {
    const before = snapshot({
      channels: [channel('100', 'A', { type: 4 }), channel('101', 'chat', { parentId: '100' })],
    });
    const after = snapshot({
      channels: [channel('100', 'A', { type: 4 }), channel('101', 'lounge', { parentId: null })],
    });
    const diff = diffSnapshots(before, after);
    expect(diff.channels.changed[0]?.changes).toEqual([
      { field: 'name', before: 'chat', after: 'lounge' },
      { field: 'parentId', before: '100', after: null },
    ]);
  });

  it('diffs permission overwrites and maps recreated roles', () => {
    const view = bitsFromPermissions(['ViewChannel']);
    const send = bitsFromPermissions(['SendMessages']);
    const before = snapshot({
      roles: [role('1', 'Muted'), role('2', 'Staff')],
      channels: [
        channel('10', 'general', {
          overwrites: [
            { id: '1', type: 'role', allow: '0', deny: send },
            { id: '2', type: 'role', allow: view, deny: '0' },
            { id: '99', type: 'member', allow: view, deny: '0' },
          ],
        }),
      ],
    });
    const after = snapshot({
      roles: [role('11', 'Muted'), role('2', 'Staff')],
      channels: [
        channel('10', 'general', {
          overwrites: [
            { id: '11', type: 'role', allow: '0', deny: send },
            {
              id: '2',
              type: 'role',
              allow: bitsFromPermissions(['ViewChannel', 'SendMessages']),
              deny: '0',
            },
            { id: '3', type: 'role', allow: '0', deny: view },
          ],
        }),
      ],
    });
    const diff = diffSnapshots(before, after);
    const overwrites = diff.channels.changed[0]?.overwrites ?? [];
    expect(overwrites).toEqual([
      {
        id: '2',
        type: 'role',
        status: 'changed',
        allow: { added: ['SendMessages'], removed: [] },
        deny: { added: [], removed: [] },
      },
      {
        id: '99',
        type: 'member',
        status: 'removed',
        allow: { added: [], removed: ['ViewChannel'] },
        deny: { added: [], removed: [] },
      },
      {
        id: '3',
        type: 'role',
        status: 'added',
        allow: { added: [], removed: [] },
        deny: { added: ['ViewChannel'], removed: [] },
      },
    ]);
  });

  it('skips overwrite diffs when a side has none captured', () => {
    const before = snapshot({ channels: [channel('10', 'a', { overwrites: null })] });
    const after = snapshot({
      channels: [
        channel('10', 'a', { overwrites: [{ id: '1', type: 'role', allow: '0', deny: '0' }] }),
      ],
    });
    expect(diffSnapshots(before, after).total).toBe(0);
  });

  it('lists changed module settings by key', () => {
    const before = snapshot({
      modules: {
        invites: { enabled: true, config: { logChannelId: '1', other: { a: 1, b: 2 } } },
        levels: { enabled: false, config: {} },
      },
    });
    const after = snapshot({
      modules: {
        invites: { enabled: true, config: { other: { b: 2, a: 1 }, logChannelId: '2' } },
        levels: { enabled: true, config: {} },
        welcome: { enabled: null, config: { channelId: '5' } },
      },
    });
    expect(diffSnapshots(before, after).modules).toEqual([
      { module: 'invites', enabled: null, keys: ['logChannelId'] },
      { module: 'levels', enabled: { before: false, after: true }, keys: [] },
      { module: 'welcome', enabled: null, keys: ['channelId'] },
    ]);
  });
});
