import {
  bitsFromPermissions,
  type SnapshotData,
  type SnapshotModule,
} from '@maxwell/core/modules/backups';
import { describe, expect, it } from 'vitest';
import { withNamedPermissions } from '../../src/modules/backups/permissions.js';
import {
  channelUndoPatch,
  executeRestore,
  mapOverwrites,
  planRestore,
  roleUndoEdit,
  undoPayload,
} from '../../src/modules/backups/restore.js';
import { deletionOrder, dueForDaily } from '../../src/modules/backups/service.js';
import { buildSnapshot, toSnapshotChannel } from '../../src/modules/backups/snapshot.js';
import { Expected, mergeChannel, mergeRole } from '../../src/modules/backups/watch.js';
import type {
  ChannelInput,
  ChannelRef,
  Overwrite,
  Platform,
  RoleEdit,
  RoleInput,
  RoleRef,
} from '../../src/platform/types.js';

const GUILD = '900000000000000001';

function roleRef(
  id: string,
  name: string,
  position: number,
  permissions = '0',
  extra: Partial<RoleRef> = {},
): RoleRef {
  return {
    id,
    name,
    color: 0,
    position,
    permissions,
    managed: false,
    hoist: false,
    mentionable: false,
    ...extra,
  };
}

function channelRef(
  id: string,
  name: string,
  type = 0,
  parentId: string | null = null,
  position = 0,
  extra: Partial<ChannelRef> = {},
): ChannelRef {
  return {
    id,
    guildId: GUILD,
    name,
    type,
    parentId,
    position,
    topic: null,
    nsfw: false,
    userLimit: null,
    rateLimitPerUser: 0,
    overwrites: [],
    ...extra,
  };
}

type ChannelPatch = Partial<ChannelInput> & { rateLimitPerUser?: number };

class FakePlatform {
  roleList: RoleRef[] = [];
  channelList: ChannelRef[] = [];
  createdRoles: RoleInput[] = [];
  createdChannels: (ChannelInput & { id: string })[] = [];
  roleEdits: { id: string; edit: RoleEdit }[] = [];
  edits: { id: string; input: ChannelPatch }[] = [];
  overwrites: { channelId: string; overwrite: Overwrite }[] = [];
  next = 1000;
  failRole: string | null = null;

  async roles() {
    return this.roleList;
  }
  async channels() {
    return this.channelList;
  }
  async createRole(_guild: string, input: RoleInput) {
    if (input.name === this.failRole) throw new Error('nope');
    const id = String(this.next++);
    this.createdRoles.push(input);
    this.roleList.push(roleRef(id, input.name, 1));
    return id;
  }
  async editRole(_guild: string, id: string, edit: RoleEdit) {
    this.roleEdits.push({ id, edit });
  }
  async createChannel(_guild: string, input: ChannelInput) {
    const id = String(this.next++);
    this.createdChannels.push({ ...input, id });
    this.channelList.push(channelRef(id, input.name, input.type, input.parentId ?? null));
    return id;
  }
  async editChannel(id: string, input: ChannelPatch) {
    this.edits.push({ id, input });
  }
  async setOverwrite(channelId: string, overwrite: Overwrite) {
    this.overwrites.push({ channelId, overwrite });
  }
}

const view = bitsFromPermissions(['ViewChannel']);
const send = bitsFromPermissions(['SendMessages']);
const admin = bitsFromPermissions(['Administrator']);
const staffBits = bitsFromPermissions(['ManageMessages', 'Speak']);

function sampleRoles(): RoleRef[] {
  return [
    roleRef(GUILD, '@everyone', 0, view),
    roleRef('1', 'Admin', 3, admin),
    roleRef('2', 'Muted', 1),
    roleRef('3', 'Staff', 2, staffBits),
  ];
}

function sample(): SnapshotData {
  return buildSnapshot(
    sampleRoles(),
    [
      channelRef('100', 'Info', 4, null, 0),
      channelRef('101', 'rules', 0, '100', 1),
      channelRef('102', 'general', 0, null, 2, {
        overwrites: [
          { id: '2', type: 'role', allow: '0', deny: send },
          { id: '3', type: 'role', allow: send, deny: '0' },
          { id: GUILD, type: 'role', allow: view, deny: '0' },
        ],
      }),
      channelRef('103', 'Voice', 2, null, 3, { userLimit: 5 }),
    ],
    {
      invites: { enabled: true, config: { logChannelId: '102' } },
      levels: { enabled: false, config: {} },
      ghost: { enabled: true, config: {} },
    },
  );
}

function deps(fake: FakePlatform) {
  return {
    platform: fake as unknown as Platform,
    readModules: async () => ({}),
    writeModules: async () => {},
    onError: () => {},
  };
}

describe('buildSnapshot', () => {
  it('sorts roles from the top and channels by position', () => {
    const data = sample();
    expect(data.version).toBe(2);
    expect(data.roles.map((r) => r.name)).toEqual(['Admin', 'Staff', 'Muted', '@everyone']);
    expect(data.channels.map((c) => c.id)).toEqual(['100', '101', '102', '103']);
    expect(data.roles[0]?.hoist).toBe(false);
  });

  it('reads topic, limits, nsfw and raw overwrites from the platform', () => {
    const ref = channelRef('5', 'x', 0, null, 0, {
      topic: 'hello',
      nsfw: true,
      rateLimitPerUser: 10,
      overwrites: [
        { id: '1', type: 'role', allow: String(1n << 10n), deny: '0' },
        { id: '9', type: 'member', allow: '0', deny: String(1n << 60n) },
      ],
    });
    expect(toSnapshotChannel(ref)).toMatchObject({
      topic: 'hello',
      nsfw: true,
      userLimit: null,
      rateLimitPerUser: 10,
      overwrites: [
        { id: '1', type: 'role', allow: '1024', deny: '0' },
        { id: '9', type: 'member', allow: '0', deny: String(1n << 60n) },
      ],
    });
  });
});

describe('planRestore', () => {
  const current = {
    roles: [
      roleRef(GUILD, '@everyone', 0, view),
      roleRef('1', 'Admin', 3, admin),
      roleRef('3', 'Staff', 2, staffBits),
    ],
    channels: [channelRef('101', 'rules-renamed', 0, null), channelRef('102', 'general', 0, null)],
  };

  it('plans a full restore of what is missing or different', () => {
    const plan = planRestore(GUILD, sample(), current, { kind: 'full' }, (key) => key !== 'ghost');
    expect(plan.roles.map((r) => r.name)).toEqual(['Muted']);
    expect(plan.roleEdits).toEqual([]);
    expect(plan.categories.map((c) => c.name)).toEqual(['Info']);
    expect(plan.channels.map((c) => c.name)).toEqual(['Voice']);
    expect(plan.edits.map((e) => `${e.source.name}:${e.fields.join(',')}`)).toEqual([
      'rules:name,parentId',
      'general:overwrites',
    ]);
    expect(plan.modules).toEqual(['invites', 'levels']);
    expect(plan.skipped.map((s) => `${s.kind}:${s.reason}`).sort()).toEqual([
      'module:unknown',
      'role:everyone',
      'role:exists',
      'role:exists',
    ]);
    expect(plan.overwrites).toEqual([]);
  });

  it('plans one role and its overwrites on live channels', () => {
    const live = {
      roles: current.roles,
      channels: [
        channelRef('102', 'general', 0, null, 2, {
          overwrites: [
            { id: '3', type: 'role', allow: send, deny: '0' },
            { id: GUILD, type: 'role', allow: view, deny: '0' },
          ],
        }),
      ],
    };
    const plan = planRestore(GUILD, sample(), live, { kind: 'role', id: '2' });
    expect(plan.roles.map((r) => r.id)).toEqual(['2']);
    expect(plan.channels).toEqual([]);
    expect(plan.edits).toEqual([]);
    expect(plan.modules).toEqual([]);
    expect(plan.overwrites).toEqual([
      { channelId: '102', overwrite: { id: '2', type: 'role', allow: '0', deny: send } },
    ]);
    expect(
      planRestore(GUILD, sample(), current, { kind: 'role', id: '3' }).skipped[0]?.reason,
    ).toBe('exists');
  });

  it('edits existing roles that drifted and keeps managed roles alone', () => {
    const live = {
      roles: [
        roleRef(GUILD, '@everyone', 0, '0'),
        roleRef('1', 'Admin', 2, admin, { managed: true }),
        roleRef('3', 'Helpers', 3, bitsFromPermissions(['ManageMessages']), {
          color: 5,
          hoist: true,
        }),
      ],
      channels: [],
    };
    const plan = planRestore(GUILD, sample(), live, { kind: 'full' });
    expect(plan.roleEdits.map((e) => [e.current.id, e.fields])).toEqual([
      ['3', ['permissions', 'name', 'color', 'hoist', 'position']],
      [GUILD, ['permissions']],
    ]);
    expect(plan.roleEdits[0]?.current).toMatchObject({ name: 'Helpers', color: 5, position: 3 });
    expect(plan.skipped.find((s) => s.id === '1')?.reason).toBe('managed');
  });

  it('does not wipe topics from snapshots taken before they were captured', () => {
    const old = sample();
    old.version = 1;
    for (const channel of old.channels) {
      channel.topic = null;
      channel.userLimit = null;
      channel.overwrites = null;
      delete channel.rateLimitPerUser;
    }
    const live = {
      roles: current.roles,
      channels: [
        channelRef('102', 'general', 0, null, 2, {
          topic: 'keep me',
          rateLimitPerUser: 30,
          overwrites: [{ id: '3', type: 'role', allow: send, deny: '0' }],
        }),
      ],
    };
    expect(planRestore(GUILD, old, live, { kind: 'channel', id: '102' }).edits).toEqual([]);
    const fresh = planRestore(GUILD, sample(), live, { kind: 'channel', id: '102' });
    expect(fresh.edits[0]?.fields).toEqual(['topic', 'rateLimitPerUser', 'overwrites']);
  });

  it('plans one channel together with its missing category', () => {
    const plan = planRestore(
      GUILD,
      sample(),
      { roles: current.roles, channels: [] },
      { kind: 'channel', id: '101' },
    );
    expect(plan.categories.map((c) => c.id)).toEqual(['100']);
    expect(plan.channels.map((c) => c.id)).toEqual(['101']);
  });

  it('plans chosen modules only', () => {
    const plan = planRestore(GUILD, sample(), current, {
      kind: 'modules',
      modules: ['levels', 'welcome'],
    });
    expect(plan.modules).toEqual(['levels']);
    expect(plan.skipped).toEqual([
      { kind: 'module', id: 'welcome', name: 'welcome', reason: 'missing' },
    ]);
  });

  it('plans a picked set of roles, channels and modules', () => {
    const plan = planRestore(
      GUILD,
      sample(),
      { roles: current.roles, channels: [channelRef('102', 'general', 0, null)] },
      { kind: 'pick', roles: ['2', '9'], channels: ['101'], modules: ['invites'] },
    );
    expect(plan.roles.map((r) => r.id)).toEqual(['2']);
    expect(plan.categories.map((c) => c.id)).toEqual(['100']);
    expect(plan.channels.map((c) => c.id)).toEqual(['101']);
    expect(plan.edits).toEqual([]);
    expect(plan.modules).toEqual(['invites']);
    expect(plan.skipped).toEqual([{ kind: 'role', id: '9', name: '9', reason: 'missing' }]);
  });

  it('leaves modules alone when a pick names none', () => {
    const plan = planRestore(GUILD, sample(), current, {
      kind: 'pick',
      roles: ['2'],
      channels: [],
      modules: [],
    });
    expect(plan.modules).toEqual([]);
  });
});

describe('executeRestore', () => {
  it('creates roles and channels, maps parents and overwrites, restores modules', async () => {
    const fake = new FakePlatform();
    fake.roleList = [roleRef(GUILD, '@everyone', 0), roleRef('1', 'Admin', 3)];
    fake.channelList = [channelRef('101', 'rules-renamed')];
    const data = sample();
    const plan = planRestore(
      GUILD,
      data,
      { roles: fake.roleList, channels: fake.channelList },
      { kind: 'full' },
      (key) => key !== 'ghost',
    );
    const written: Record<string, SnapshotModule>[] = [];
    const result = await executeRestore(
      {
        platform: fake as unknown as Platform,
        readModules: async () => ({ invites: { enabled: false, config: {} } }),
        writeModules: async (_guild, states) => {
          written.push(states);
        },
        onError: () => {},
      },
      GUILD,
      data,
      plan,
      'test',
    );

    expect(fake.createdRoles.map((r) => r.name)).toEqual(['Staff', 'Muted']);
    expect(fake.createdRoles[0]?.permissions).toEqual(['ManageMessages']);
    expect(fake.createdRoles[0]?.permissionBits).toBe(staffBits);
    expect(fake.roleEdits).toEqual([
      { id: '1', edit: { permissionBits: admin } },
      { id: GUILD, edit: { permissionBits: view } },
    ]);
    const staff = result.roles.find((r) => r.name === 'Staff')?.id;
    const muted = result.roles.find((r) => r.name === 'Muted')?.id;
    const info = result.channels.find((c) => c.name === 'Info')?.id;

    const general = fake.createdChannels.find((c) => c.name === 'general');
    expect(general?.overwrites).toEqual([
      {
        id: muted,
        type: 'role',
        allow: [],
        deny: ['SendMessages'],
        allowBits: '0',
        denyBits: send,
      },
      {
        id: staff,
        type: 'role',
        allow: ['SendMessages'],
        deny: [],
        allowBits: send,
        denyBits: '0',
      },
      { id: GUILD, type: 'role', allow: ['ViewChannel'], deny: [], allowBits: view, denyBits: '0' },
    ]);
    expect(fake.createdChannels.find((c) => c.name === 'Voice')?.userLimit).toBe(5);
    expect(fake.edits).toEqual([{ id: '101', input: { name: 'rules', parentId: info } }]);
    expect(written).toEqual([
      {
        invites: { enabled: true, config: { logChannelId: '102' } },
        levels: { enabled: false, config: {} },
      },
    ]);
    expect(result.previousModules).toEqual({
      invites: { enabled: false, config: {} },
      levels: { enabled: null, config: {} },
    });

    const undo = undoPayload(result);
    expect(undo.roles).toEqual([staff, muted]);
    expect(undo.edits).toEqual([
      {
        state: {
          id: '101',
          name: 'rules-renamed',
          parentId: null,
          topic: null,
          userLimit: null,
          rateLimitPerUser: 0,
          overwrites: [],
        },
        fields: ['name', 'parentId'],
      },
    ]);
    expect(undo.roleEdits).toEqual([
      { state: expect.objectContaining({ id: '1', permissions: '0' }), fields: ['permissions'] },
      { state: expect.objectContaining({ id: GUILD, permissions: '0' }), fields: ['permissions'] },
    ]);
  });

  it('replaces drifted overwrites with raw bits and restores topic and slowmode', async () => {
    const fake = new FakePlatform();
    fake.roleList = sampleRoles();
    const speak = String(1n << 21n);
    fake.channelList = [
      channelRef('102', 'general', 0, null, 2, {
        topic: 'changed',
        rateLimitPerUser: 15,
        overwrites: [{ id: '3', type: 'role', allow: '0', deny: send }],
      }),
    ];
    const data = sample();
    const general = data.channels.find((c) => c.id === '102');
    if (!general?.overwrites) throw new Error('fixture');
    general.topic = 'Say hi';
    general.overwrites[1] = {
      id: '3',
      type: 'role',
      allow: String(BigInt(send) | (1n << 21n)),
      deny: '0',
    };
    const plan = planRestore(
      GUILD,
      data,
      { roles: fake.roleList, channels: fake.channelList },
      { kind: 'channel', id: '102' },
    );
    const result = await executeRestore(deps(fake), GUILD, data, plan, 'test');
    expect(fake.edits).toHaveLength(1);
    const patch = fake.edits[0]?.input;
    expect(patch?.topic).toBe('Say hi');
    expect(patch?.rateLimitPerUser).toBe(0);
    expect(patch?.overwrites?.find((o) => o.id === '3')).toMatchObject({
      allow: ['SendMessages'],
      allowBits: String(BigInt(send) | BigInt(speak)),
    });
    expect(patch?.overwrites?.map((o) => o.id)).toEqual(['2', '3', GUILD]);

    const undo = channelUndoPatch((undoPayload(result).edits as unknown[])[0]);
    expect(undo?.id).toBe('102');
    expect(undo?.patch).toEqual({
      topic: 'changed',
      rateLimitPerUser: 15,
      overwrites: [
        {
          id: '3',
          type: 'role',
          allow: [],
          deny: ['SendMessages'],
          allowBits: '0',
          denyBits: send,
        },
      ],
    });
  });

  it('reapplies overwrites for a single recreated role and records failures', async () => {
    const fake = new FakePlatform();
    fake.roleList = [
      roleRef(GUILD, '@everyone', 0),
      roleRef('1', 'Admin', 3),
      roleRef('3', 'Staff', 2),
    ];
    fake.channelList = [channelRef('102', 'general')];
    const data = sample();
    const plan = planRestore(
      GUILD,
      data,
      { roles: fake.roleList, channels: fake.channelList },
      { kind: 'role', id: '2' },
    );
    const result = await executeRestore(deps(fake), GUILD, data, plan, 'test');
    expect(fake.overwrites).toEqual([
      {
        channelId: '102',
        overwrite: {
          id: result.roles[0]?.id,
          type: 'role',
          allow: [],
          deny: ['SendMessages'],
          allowBits: '0',
          denyBits: send,
        },
      },
    ]);

    const failing = new FakePlatform();
    failing.failRole = 'Muted';
    const again = await executeRestore(
      { ...deps(fake), platform: failing as unknown as Platform },
      GUILD,
      data,
      plan,
      'test',
    );
    expect(again.failed).toEqual([{ kind: 'role', name: 'Muted' }]);
    expect(failing.overwrites).toEqual([]);
  });

  it('drops overwrites for roles that are gone', () => {
    const mapped = mapOverwrites(
      GUILD,
      [
        { id: 'gone', type: 'role', allow: view, deny: '0' },
        { id: 'live', type: 'role', allow: view, deny: '0' },
        { id: 'user', type: 'member', allow: '0', deny: view },
      ],
      new Map(),
      new Set(['live']),
    );
    expect(mapped?.map((o) => o.id)).toEqual(['live', 'user']);
    expect(mapOverwrites(GUILD, null, new Map(), new Set())).toBeUndefined();
  });
});

describe('undo payloads', () => {
  it('reads channel edits written before more fields were tracked', () => {
    expect(channelUndoPatch({ id: '5', name: 'old', parentId: null })).toEqual({
      id: '5',
      patch: { name: 'old', parentId: null },
    });
    expect(channelUndoPatch('junk')).toBeNull();
  });

  it('turns a role edit back into the previous state', () => {
    expect(
      roleUndoEdit({
        state: {
          id: '3',
          name: 'Staff',
          color: 7,
          permissions: '8',
          hoist: true,
          mentionable: false,
          position: 4,
        },
        fields: ['name', 'permissions', 'position', 'bogus'],
      }),
    ).toEqual({ id: '3', edit: { name: 'Staff', permissionBits: '8', position: 4 } });
    expect(roleUndoEdit({ state: { id: '3' }, fields: [] })).toBeNull();
  });
});

describe('helpers', () => {
  it('waits about a day between daily snapshots', () => {
    const now = Date.parse('2026-10-21T12:00:00Z');
    expect(dueForDaily(null, now)).toBe(true);
    expect(dueForDaily(new Date(now - 22 * 3_600_000), now)).toBe(false);
    expect(dueForDaily(new Date(now - 23 * 3_600_000), now)).toBe(true);
  });

  it('deletes channels before their categories', () => {
    const channels = [channelRef('1', 'cat', 4), channelRef('2', 'a', 0, '1')];
    expect(deletionOrder(channels, ['1', '2'])).toEqual(['2', '1']);
  });

  it('merges deleted role and channel data with the snapshot', () => {
    const saved = sample();
    const savedRole = saved.roles.find((r) => r.id === '3') ?? null;
    const merged = mergeRole(savedRole, {
      ...(savedRole ?? saved.roles[0]),
      id: '3',
      name: 'Staff team',
      hoist: null,
    } as never);
    expect(merged).toMatchObject({ id: '3', name: 'Staff team', hoist: false });
    const savedChannel = saved.channels.find((c) => c.id === '102') ?? null;
    const live = toSnapshotChannel(channelRef('102', 'general-2'));
    const channel = mergeChannel(savedChannel, live);
    expect(channel?.name).toBe('general-2');
    expect(channel?.overwrites).toEqual([]);
    const unknown = { ...live, overwrites: null };
    expect(mergeChannel(savedChannel, unknown)?.overwrites).toHaveLength(3);
  });

  it('remembers ids Maxwell deleted itself only once', () => {
    const expected = new Expected();
    expected.mark('5');
    expect(expected.take('5')).toBe(true);
    expect(expected.take('5')).toBe(false);
    expect(expected.take('6')).toBe(false);
  });

  it('keeps permission bits outside the named list when applying named ones', () => {
    const speak = 1n << 21n;
    const current = String(speak | (1n << 11n));
    expect(withNamedPermissions(current, ['ViewChannel'])).toBe(String(speak | (1n << 10n)));
  });
});
