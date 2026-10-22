import definition, { voiceConfig } from '@maxwell/core/modules/voice';
import type { VoiceRoom, VoiceStore } from '@maxwell/core/stores/voice';
import { describe, expect, it, vi } from 'vitest';
import { cleanName, nextNumber, roomName } from '../../src/modules/voice/naming.js';
import {
  ownerOverwrite,
  Rooms,
  statusOf,
  withMember,
  withoutMember,
} from '../../src/modules/voice/rooms.js';
import type { ModuleContext } from '../../src/runtime/module.js';

const guildId = '900000000000000001';
const lobbyId = '210000000000000001';
const lena = '300000000000000001';
const max = '300000000000000002';

describe('voice config', () => {
  it('parses an empty object', () => {
    const config = voiceConfig.parse({});
    expect(config.lobbies).toEqual([]);
    expect(config.ownerPermissions).toBe(true);
  });

  it('fills lobby defaults', () => {
    const config = voiceConfig.parse({ lobbies: [{ channelId: lobbyId }] });
    expect(config.lobbies[0]).toEqual({
      channelId: lobbyId,
      categoryId: null,
      nameTemplate: "{name}'s room",
      userLimit: 0,
    });
  });

  it('keeps table names prefixed with the module key', () => {
    for (const migration of definition.migrations) {
      const tables = [...migration.up.matchAll(/create table (\w+)/g)].map((m) => m[1]);
      for (const table of tables) expect(table?.startsWith('voice_')).toBe(true);
    }
  });
});

describe('naming', () => {
  it('fills the template', () => {
    expect(roomName("{name}'s room #{n}", { name: 'Lena', username: 'lena', n: 2 })).toBe(
      "Lena's room #2",
    );
  });

  it('falls back and trims long names', () => {
    expect(roomName('   ', { name: '', username: '', n: 1 })).toBe('Voice room');
    expect(roomName('{name}', { name: 'x'.repeat(150), username: '', n: 1 })).toHaveLength(100);
    expect(roomName('{unknown}', { name: 'a', username: 'b', n: 1 })).toBe('{unknown}');
  });

  it('cleans user input', () => {
    expect(cleanName('  late   night  ')).toBe('late night');
    expect(cleanName('   ')).toBeNull();
  });

  it('reuses the lowest free number', () => {
    expect(nextNumber([])).toBe(1);
    expect(nextNumber([1, 2, 4])).toBe(3);
  });
});

describe('helpers', () => {
  it('tracks members without duplicates', () => {
    expect(withMember([lena], lena)).toEqual([lena]);
    expect(withMember([lena], max)).toEqual([lena, max]);
    expect(withoutMember([lena, max], lena)).toEqual([max]);
  });

  it('reads status codes from errors', () => {
    expect(statusOf({ statusCode: 404 })).toBe(404);
    expect(statusOf(new Error('x'))).toBeNull();
  });

  it('gives owners control of their room', () => {
    expect(ownerOverwrite(lena)).toMatchObject({ id: lena, type: 'member', deny: [] });
    expect(ownerOverwrite(lena).allow).toContain('ManageChannels');
  });
});

describe('Rooms', () => {
  function setup() {
    const config = voiceConfig.parse({
      lobbies: [{ channelId: lobbyId, nameTemplate: '{name} #{n}', userLimit: 5 }],
    });
    const rows = new Map<string, VoiceRoom>();
    const present = new Map<string, string[]>();
    const store = {
      list: async (guild: string) => [...rows.values()].filter((row) => row.guildId === guild),
      listFor: async (guilds: string[]) =>
        [...rows.values()].filter((row) => guilds.includes(row.guildId)),
      create: async (room: Omit<VoiceRoom, 'createdAt' | 'locked'>) => {
        const row = { ...room, locked: false, createdAt: new Date() };
        rows.set(room.channelId, row);
        return row;
      },
      setMembers: vi.fn(async () => {}),
      setOwner: vi.fn(async () => {}),
      remove: vi.fn(async (id: string) => rows.delete(id)),
    };
    const platform = {
      selfId: '1',
      member: async (_g: string, userId: string) => ({
        user: { id: userId, username: 'lena', displayName: 'Lena', bot: false },
        nick: null,
        roles: [],
      }),
      guildIds: () => [guildId],
      voiceMembers: (_g: string, channelId: string) => present.get(channelId) ?? [],
      channels: vi.fn(async () => [
        { id: lobbyId, parentId: '220000000000000001' },
        { id: '230000000000000001', parentId: '220000000000000001' },
      ]),
      createChannel: vi.fn(async () => '230000000000000001'),
      moveVoice: vi.fn(async () => {}),
      deleteChannel: vi.fn(async () => {}),
      setOverwrite: vi.fn(async () => {}),
    };
    const schedule = vi.fn(async () => '1');
    const ctx = {
      config: async () => config,
      enabled: async () => true,
      schedule,
      services: { platform, log: { warn() {}, info() {}, debug() {}, error() {} } },
    } as unknown as ModuleContext<typeof voiceConfig>;
    const rooms = new Rooms(ctx, store as unknown as VoiceStore);
    return { rooms, platform, schedule, store, rows, present };
  }

  it('creates a room in the lobby category and moves the member', async () => {
    const { rooms, platform, rows } = setup();
    await rooms.onVoice({ guildId, userId: lena, channelId: lobbyId, before: null });
    expect(platform.createChannel).toHaveBeenCalledWith(
      guildId,
      expect.objectContaining({
        name: 'Lena #1',
        type: 2,
        parentId: '220000000000000001',
        userLimit: 5,
      }),
      expect.any(String),
    );
    expect(platform.moveVoice).toHaveBeenCalledWith(guildId, lena, '230000000000000001');
    expect(rows.get('230000000000000001')?.ownerId).toBe(lena);
  });

  it('hands the room over and cleans up once empty', async () => {
    const { rooms, platform, schedule } = setup();
    const room = '230000000000000001';
    await rooms.onVoice({ guildId, userId: lena, channelId: lobbyId, before: null });
    await rooms.onVoice({ guildId, userId: lena, channelId: room, before: lobbyId });
    await rooms.onVoice({ guildId, userId: max, channelId: room, before: null });
    await rooms.onVoice({ guildId, userId: lena, channelId: null, before: room });
    expect((await rooms.get(guildId, room))?.ownerId).toBe(max);
    expect(platform.setOverwrite).toHaveBeenCalled();

    schedule.mockClear();
    await rooms.onVoice({ guildId, userId: max, channelId: null, before: room });
    expect(schedule).toHaveBeenCalledWith(
      'room.cleanup',
      expect.objectContaining({ payload: { channelId: room } }),
    );
    await rooms.cleanup({
      id: '1',
      kind: 'voice.room.cleanup',
      guildId,
      payload: { channelId: room },
      runAt: new Date(),
      attempts: 1,
    });
    expect(platform.deleteChannel).toHaveBeenCalledWith(room, expect.any(String));
    expect(await rooms.get(guildId, room)).toBeNull();
  });

  it('drops a member from a stale room when they show up elsewhere', async () => {
    const { rooms } = setup();
    const room = '230000000000000001';
    await rooms.onVoice({ guildId, userId: lena, channelId: lobbyId, before: null });
    await rooms.onVoice({ guildId, userId: lena, channelId: room, before: lobbyId });
    await rooms.onVoice({ guildId, userId: lena, channelId: '240000000000000001', before: null });
    expect((await rooms.get(guildId, room))?.members).toEqual([]);
  });

  it('sends an owner back to their room instead of making another', async () => {
    const { rooms, platform } = setup();
    await rooms.onVoice({ guildId, userId: lena, channelId: lobbyId, before: null });
    await rooms.onVoice({ guildId, userId: lena, channelId: lobbyId, before: null });
    expect(platform.createChannel).toHaveBeenCalledOnce();
    expect(platform.moveVoice).toHaveBeenCalledTimes(2);
  });

  it('leaves the room up longer when the bot may not move the member', async () => {
    const { rooms, platform, schedule } = setup();
    platform.moveVoice.mockRejectedValueOnce(Object.assign(new Error('x'), { statusCode: 403 }));
    const before = Date.now();
    await rooms.onVoice({ guildId, userId: lena, channelId: lobbyId, before: null });
    const runAt = (schedule.mock.calls[0] as unknown[])[1] as { runAt: Date };
    expect(runAt.runAt.getTime() - before).toBeGreaterThanOrEqual(30_000);
  });

  it('cleans up quickly when the move fails for another reason', async () => {
    const { rooms, platform, schedule } = setup();
    platform.moveVoice.mockRejectedValueOnce(Object.assign(new Error('x'), { statusCode: 400 }));
    const before = Date.now();
    await rooms.onVoice({ guildId, userId: lena, channelId: lobbyId, before: null });
    const runAt = (schedule.mock.calls[0] as unknown[])[1] as { runAt: Date };
    expect(runAt.runAt.getTime() - before).toBeLessThan(30_000);
  });

  function seed(rows: Map<string, VoiceRoom>, channelId: string, members: string[]) {
    rows.set(channelId, {
      channelId,
      guildId,
      lobbyId,
      ownerId: lena,
      number: 1,
      members,
      locked: false,
      createdAt: new Date(0),
    });
  }

  it('keeps a room that still has people in it', async () => {
    const { rooms, platform, rows, present, store } = setup();
    const room = '230000000000000001';
    seed(rows, room, []);
    present.set(room, [max]);
    await rooms.cleanup({
      id: '1',
      kind: 'voice.room.cleanup',
      guildId,
      payload: { channelId: room },
      runAt: new Date(),
      attempts: 1,
    });
    expect(platform.deleteChannel).not.toHaveBeenCalled();
    expect(store.setMembers).toHaveBeenCalledWith(room, [max]);
    expect((await rooms.get(guildId, room))?.ownerId).toBe(max);
  });

  it('checks rooms against live voice state after a restart', async () => {
    const { rooms, rows, present, schedule, store, platform } = setup();
    const empty = '230000000000000001';
    const busy = '230000000000000002';
    const gone = '230000000000000003';
    seed(rows, empty, [lena]);
    seed(rows, busy, [lena]);
    seed(rows, gone, []);
    present.set(busy, [lena, max]);
    platform.channels.mockResolvedValue([
      { id: empty, parentId: '220000000000000001' },
      { id: busy, parentId: '220000000000000001' },
    ]);
    await rooms.sweep();
    expect(store.setMembers).toHaveBeenCalledWith(empty, []);
    expect(store.setMembers).toHaveBeenCalledWith(busy, [lena, max]);
    expect(store.remove).toHaveBeenCalledWith(gone);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(
      'room.cleanup',
      expect.objectContaining({ payload: { channelId: empty } }),
    );
  });

  it('hands over owned rooms when the owner asks to be forgotten', async () => {
    const { rooms, rows, present } = setup();
    const room = '230000000000000001';
    seed(rows, room, [lena, max]);
    present.set(room, [lena, max]);
    await rooms.forgetMember(guildId, lena);
    expect((await rooms.get(guildId, room))?.ownerId).toBe(max);
  });
});
