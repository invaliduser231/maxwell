import type { Job } from '@maxwell/core';
import type { VoiceConfig, VoiceLobby, voiceConfig } from '@maxwell/core/modules/voice';
import type { VoiceRoom, VoiceStore } from '@maxwell/core/stores/voice';
import { ChannelKind, type Overwrite, type VoiceChange } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { Recent } from '../roles/cache.js';
import { copy } from './copy.js';
import { nextNumber, roomName } from './naming.js';

type Ctx = ModuleContext<typeof voiceConfig>;

const CLEANUP_DELAY = 5_000;
const SAFETY_DELAY = 30_000;

export const ownerAllow = ['ViewChannel', 'Connect', 'ManageChannels', 'MoveMembers'] as const;

export function ownerOverwrite(userId: string): Overwrite {
  return { id: userId, type: 'member', allow: ownerAllow, deny: [] };
}

export function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = (error as { statusCode?: unknown; status?: unknown }).statusCode;
  return typeof status === 'number' ? status : null;
}

export function withMember(members: readonly string[], userId: string): string[] {
  return members.includes(userId) ? [...members] : [...members, userId];
}

export function withoutMember(members: readonly string[], userId: string): string[] {
  return members.filter((id) => id !== userId);
}

export function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export class Rooms {
  readonly #rooms = new Map<string, VoiceRoom>();
  readonly #loaded = new Set<string>();
  readonly #creating = new Set<string>();
  readonly #warned = new Recent<true>(2_000, 6 * 60 * 60_000);

  constructor(
    private readonly ctx: Ctx,
    private readonly store: VoiceStore,
  ) {}

  async #load(guildId: string): Promise<void> {
    if (this.#loaded.has(guildId)) return;
    const rooms = await this.store.list(guildId);
    for (const room of rooms) this.#rooms.set(room.channelId, room);
    this.#loaded.add(guildId);
  }

  async rooms(guildId: string): Promise<VoiceRoom[]> {
    await this.#load(guildId);
    return [...this.#rooms.values()].filter((room) => room.guildId === guildId);
  }

  async get(guildId: string, channelId: string): Promise<VoiceRoom | null> {
    await this.#load(guildId);
    const room = this.#rooms.get(channelId);
    return room?.guildId === guildId ? room : null;
  }

  async roomOf(guildId: string, userId: string): Promise<VoiceRoom | null> {
    const rooms = await this.rooms(guildId);
    return (
      rooms.find((room) => room.members.includes(userId)) ??
      rooms.find((room) => room.ownerId === userId) ??
      null
    );
  }

  async onVoice(change: VoiceChange): Promise<void> {
    const { guildId, userId, channelId } = change;
    const rooms = await this.rooms(guildId);

    for (const room of rooms) {
      if (room.channelId === channelId || !room.members.includes(userId)) continue;
      await this.#leave(room, userId);
    }

    const target = channelId ? this.#rooms.get(channelId) : undefined;
    if (target && target.guildId === guildId) {
      await this.#join(target, userId);
      return;
    }

    if (!channelId || !(await this.ctx.enabled(guildId))) return;
    const config = await this.ctx.config(guildId);
    const lobby = config.lobbies.find((candidate) => candidate.channelId === channelId);
    if (lobby) await this.#create(guildId, userId, lobby, config);
  }

  async onChannelDelete(guildId: string, channelId: string): Promise<void> {
    const room = await this.get(guildId, channelId);
    if (!room) return;
    this.#rooms.delete(channelId);
    await this.store.remove(channelId);
  }

  async cleanup(job: Job): Promise<void> {
    const channelId = job.payload.channelId;
    if (!job.guildId || typeof channelId !== 'string') return;
    const room = await this.get(job.guildId, channelId);
    if (!room) return;
    if ((await this.#reconcile(room)) > 0) return;
    await this.#delete(room);
  }

  async sweep(only?: string): Promise<void> {
    const { platform, log } = this.ctx.services;
    const local = only ? [only] : platform.guildIds();
    const rooms = await this.store.listFor(local);
    const guilds = new Set(rooms.map((room) => room.guildId));
    for (const guildId of guilds) {
      this.#loaded.delete(guildId);
      for (const [channelId, room] of this.#rooms) {
        if (room.guildId === guildId) this.#rooms.delete(channelId);
      }
      const channels = await platform.channels(guildId).catch(() => null);
      const existing = channels ? new Set(channels.map((channel) => channel.id)) : null;
      for (const room of await this.rooms(guildId)) {
        if (existing && !existing.has(room.channelId)) {
          this.#rooms.delete(room.channelId);
          await this.store.remove(room.channelId);
          continue;
        }
        if ((await this.#reconcile(room)) === 0) await this.#scheduleCleanup(room, CLEANUP_DELAY);
      }
    }
    if (rooms.length) log.info({ rooms: rooms.length }, 'voice rooms checked');
  }

  async #reconcile(room: VoiceRoom): Promise<number> {
    const present = this.ctx.services.platform.voiceMembers(room.guildId, room.channelId);
    if (!sameMembers(present, room.members)) {
      room.members = [...present];
      await this.store.setMembers(room.channelId, room.members);
    }
    if (present.length > 0 && !present.includes(room.ownerId)) await this.#handover(room);
    return present.length;
  }

  async #handover(room: VoiceRoom): Promise<void> {
    const config = await this.ctx.config(room.guildId);
    const next = room.members.find((id) => id !== room.ownerId);
    if (!config.transferOnLeave || !next) return;
    await this.transfer(room, next).catch((error) =>
      this.ctx.services.log.warn(
        { err: error, guild: room.guildId, channel: room.channelId },
        'room handover failed',
      ),
    );
  }

  async forgetMember(guildId: string, userId: string): Promise<void> {
    for (const room of await this.rooms(guildId)) {
      if (room.ownerId !== userId) continue;
      await this.#reconcile(room);
      if (room.ownerId === userId) await this.#handover(room);
    }
  }

  async rename(room: VoiceRoom, name: string): Promise<void> {
    await this.ctx.services.platform.editChannel(room.channelId, { name }, copy.reasons.command);
  }

  async setLimit(room: VoiceRoom, limit: number): Promise<void> {
    await this.ctx.services.platform.editChannel(
      room.channelId,
      { userLimit: limit },
      copy.reasons.command,
    );
  }

  async setLocked(room: VoiceRoom, locked: boolean): Promise<void> {
    await this.ctx.services.platform.setOverwrite(
      room.channelId,
      { id: room.guildId, type: 'role', allow: [], deny: locked ? ['Connect'] : [] },
      copy.reasons.command,
    );
    room.locked = locked;
    await this.store.setLocked(room.channelId, locked);
  }

  async transfer(room: VoiceRoom, ownerId: string): Promise<void> {
    const previous = room.ownerId;
    if (previous === ownerId) return;
    const config = await this.ctx.config(room.guildId);
    if (config.ownerPermissions) {
      const { platform } = this.ctx.services;
      await platform.setOverwrite(room.channelId, ownerOverwrite(ownerId), copy.reasons.command);
      await platform
        .setOverwrite(
          room.channelId,
          { id: previous, type: 'member', allow: [], deny: [] },
          copy.reasons.command,
        )
        .catch(() => {});
    }
    room.ownerId = ownerId;
    await this.store.setOwner(room.channelId, ownerId);
  }

  async #join(room: VoiceRoom, userId: string): Promise<void> {
    if (room.members.includes(userId)) return;
    room.members = withMember(room.members, userId);
    await this.store.setMembers(room.channelId, room.members);
  }

  async #leave(room: VoiceRoom, userId: string): Promise<void> {
    room.members = withoutMember(room.members, userId);
    await this.store.setMembers(room.channelId, room.members);
    if (room.members.length === 0) {
      await this.#scheduleCleanup(room, CLEANUP_DELAY);
      return;
    }
    if (room.ownerId !== userId) return;
    await this.#handover(room);
  }

  async #create(
    guildId: string,
    userId: string,
    lobby: VoiceLobby,
    config: VoiceConfig,
  ): Promise<void> {
    const key = `${guildId}:${userId}`;
    if (this.#creating.has(key)) return;
    this.#creating.add(key);
    const { platform, log } = this.ctx.services;
    try {
      const rooms = await this.rooms(guildId);
      const owned = rooms.find((room) => room.ownerId === userId);
      if (owned) {
        await platform.moveVoice(guildId, userId, owned.channelId).catch(() => {});
        return;
      }
      if (rooms.length >= config.maxRooms) return;

      const [member, channels] = await Promise.all([
        platform.member(guildId, userId),
        platform.channels(guildId).catch(() => []),
      ]);
      if (!member) return;
      const parentId =
        lobby.categoryId ??
        channels.find((channel) => channel.id === lobby.channelId)?.parentId ??
        null;
      const number = nextNumber(
        rooms.filter((room) => room.lobbyId === lobby.channelId).map((room) => room.number),
      );
      const name = roomName(lobby.nameTemplate, {
        name: member.nick ?? member.user.displayName,
        username: member.user.username,
        n: number,
      });

      let channelId: string;
      try {
        channelId = await platform.createChannel(
          guildId,
          {
            name,
            type: ChannelKind.Voice,
            parentId,
            userLimit: lobby.userLimit > 0 ? lobby.userLimit : undefined,
            overwrites: config.ownerPermissions ? [ownerOverwrite(userId)] : [],
          },
          copy.reasons.created,
        );
      } catch (error) {
        this.#warn(guildId, error);
        return;
      }

      const room = await this.store.create({
        channelId,
        guildId,
        lobbyId: lobby.channelId,
        ownerId: userId,
        number,
        members: [],
      });
      this.#rooms.set(channelId, room);

      try {
        await platform.moveVoice(guildId, userId, channelId);
      } catch (error) {
        const forbidden = statusOf(error) === 403;
        if (forbidden) this.#warnMove(guildId, error);
        else log.info({ err: error, guild: guildId }, 'could not move member into new room');
        await this.#scheduleCleanup(room, forbidden ? SAFETY_DELAY : CLEANUP_DELAY);
        return;
      }
      await this.#scheduleCleanup(room, SAFETY_DELAY);
    } finally {
      this.#creating.delete(key);
    }
  }

  async #delete(room: VoiceRoom): Promise<void> {
    try {
      await this.ctx.services.platform.deleteChannel(room.channelId, copy.reasons.empty);
    } catch (error) {
      const status = statusOf(error);
      if (status !== 404) {
        if (status === 403) this.#warn(room.guildId, error);
        throw error;
      }
    }
    this.#rooms.delete(room.channelId);
    await this.store.remove(room.channelId);
  }

  async #scheduleCleanup(room: VoiceRoom, delay: number): Promise<void> {
    await this.ctx.schedule('room.cleanup', {
      guildId: room.guildId,
      payload: { channelId: room.channelId },
      runAt: new Date(Date.now() + delay),
    });
  }

  #warn(guildId: string, error: unknown): void {
    if (this.#warned.has(guildId)) return;
    this.#warned.set(guildId, true);
    this.ctx.services.log.warn(
      { err: error, guild: guildId },
      'voice rooms need Manage Channels and Move Members',
    );
  }

  #warnMove(guildId: string, error: unknown): void {
    const key = `${guildId}:move`;
    if (this.#warned.has(key)) return;
    this.#warned.set(key, true);
    this.ctx.services.log.warn(
      { err: error, guild: guildId },
      'cannot move members ranked at or above the bot role into voice rooms',
    );
  }
}
