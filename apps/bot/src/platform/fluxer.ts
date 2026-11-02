import { EventEmitter } from 'node:events';
import {
  Client,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildChannel,
  type GuildMember,
  type Message,
  type MessageSendOptions,
  PermissionFlags,
  type PermissionsBitField,
  type Role,
  Routes,
  type User,
} from '@fluxerjs/core';
import type { Logger } from '../log.js';
import { flatten } from '../ui/markdown.js';
import type {
  BanOptions,
  ChannelInput,
  ChannelRef,
  Embed,
  GuildRef,
  IncomingMessage,
  JoinSourceLookup,
  MemberRef,
  MemberRoles,
  Outgoing,
  OutgoingMessage,
  Overwrite,
  Permission,
  Platform,
  PlatformEvents,
  ReactionEvent,
  RoleEdit,
  RoleInput,
  RoleRef,
  UserRef,
} from './types.js';
import { permissions } from './types.js';

const ignoredEvents = [
  'TYPING_START',
  'PRESENCE_UPDATE',
  'PRESENCE_UPDATE_BULK',
  'PASSIVE_UPDATES',
  'GUILD_MEMBER_LIST_UPDATE',
  'THREAD_MEMBER_LIST_UPDATE',
  'ENTRANCE_SOUND_PLAY',
  'FORUM_UNREADS',
];

const SUPPRESS_NOTIFICATIONS = 1 << 12;
const TEXT_CHANNEL = 0;
const INVITES_DISABLED = 'INVITES_DISABLED';
const SNOWFLAKE = /^\d{1,21}$/;

interface MemberSearchResponse {
  members: {
    user_id: string;
    joined_at: number;
    supplemental?: {
      join_source_type?: number | null;
      source_invite_code?: string | null;
      inviter_id?: string | null;
    };
  }[];
  indexing: boolean;
}

interface WireVoiceState {
  guild_id?: string | null;
  user_id?: string;
  channel_id?: string | null;
}

export interface FluxerOptions {
  token: string;
  api?: string;
  log: Logger;
}

export class FluxerPlatform implements Platform {
  readonly #client: Client;
  readonly #events = new EventEmitter();
  readonly #token: string;
  readonly #log: Logger;
  readonly #voice = new Map<string, string>();
  readonly #voiceSynced = new Set<string>();
  #ready = false;

  constructor(options: FluxerOptions) {
    this.#token = options.token;
    this.#log = options.log;
    this.#events.setMaxListeners(100);
    this.#client = new Client({
      instance: options.api ? { api_public: options.api } : undefined,
      ignoredEvents,
      waitForGuilds: true,
      gatewayDebug: false,
      cache: { messages: 200, guilds: 0, channels: 0 },
      defaultAllowedMentions: { parse: [], repliedUser: false },
      defaultReplyPing: false,
    });
    this.#wire();
  }

  get selfId(): string | null {
    return this.#client.user?.id ?? null;
  }

  on<K extends keyof PlatformEvents>(event: K, listener: PlatformEvents[K]): void {
    this.#events.on(event, listener);
  }

  #emit<K extends keyof PlatformEvents>(event: K, ...args: Parameters<PlatformEvents[K]>): void {
    this.#events.emit(event, ...args);
  }

  #wire(): void {
    const client = this.#client;

    client.on(Events.Ready, () => {
      this.#ready = true;
      this.#log.info({ user: client.user?.username, guilds: client.guilds.size }, 'gateway ready');
      this.#emit('ready');
    });
    client.on(Events.Resumed, () => this.#log.info('gateway resumed'));
    client.on(Events.ShardDisconnect, (shard, code) => {
      this.#log.warn({ shard, code }, 'shard disconnected');
    });
    client.on(Events.ShardReconnecting, (shard) => this.#log.info({ shard }, 'shard reconnecting'));
    client.on(Events.ShardingRequired, (payload) => {
      this.#log.error(payload, 'gateway requires more shards');
    });
    client.on(Events.Error, (error) => this.#log.error({ err: error }, 'client error'));

    client.on(Events.MessageCreate, (message) => this.#emit('message', toIncoming(message)));
    client.on(Events.MessageUpdate, (old, next) => {
      if (next.partial) return;
      if (old && old.content === next.content) return;
      this.#emit('messageEdit', { message: toIncoming(next), before: old?.content ?? null });
    });
    client.on(Events.MessageDelete, (message) => {
      this.#emit('messageRemove', {
        id: message.id,
        channelId: message.channelId,
        guildId: message.guildId,
        content: message.content,
        authorId: message.authorId,
      });
    });
    client.on(Events.MessageDeleteBulk, (payload) => {
      this.#emit('messageBulkRemove', {
        channelId: payload.channelId,
        guildId: payload.guildId ?? null,
        ids: [...payload.ids],
      });
    });
    client.on(Events.MessageReactionAdd, (payload) => {
      if (payload.userId === client.user?.id) return;
      this.#emit('reaction', toReaction(payload, this.#isBot(payload.userId)));
    });
    client.on(Events.MessageReactionRemove, (payload) => {
      if (payload.userId === client.user?.id) return;
      this.#emit('reactionRemove', toReaction(payload, this.#isBot(payload.userId)));
    });
    client.on(Events.GuildAuditLogEntryCreate, (entry) => {
      if (!entry.guildId) return;
      this.#emit('auditLog', {
        id: entry.id,
        guildId: entry.guildId,
        action: entry.actionType,
        actorId: entry.userId,
        targetId: entry.targetId,
        reason: entry.reason,
        changes: entry.changes.map((change) => ({
          key: change.key,
          before: change.oldValue ?? null,
          after: change.newValue ?? null,
        })),
      });
    });

    client.on(Events.GuildMemberAdd, (member) => {
      this.#emit('memberJoin', {
        guildId: member.guild.id,
        user: toUserRef(member.user),
        joinedAt: member.joinedAt,
      });
    });
    client.on(Events.GuildMemberRemove, (member) => {
      this.#emit('memberLeave', {
        guildId: member.guild.id,
        userId: member.id,
        user: member.user ? toUserRef(member.user) : null,
      });
    });
    client.on(Events.GuildMemberUpdate, (old, next) => {
      this.#emit('memberUpdate', {
        guildId: next.guild.id,
        user: toUserRef(next.user),
        nick: next.nick,
        roles: [...next.roles.roleIds],
        timeoutUntil: next.communicationDisabledUntil,
        before: old
          ? {
              nick: old.nick,
              roles: [...old.roles.roleIds],
              timeoutUntil: old.communicationDisabledUntil,
            }
          : null,
      });
    });

    client.on(Events.GuildRoleCreate, (role) => {
      this.#emit('roleCreate', {
        guildId: role.guildId,
        role: toRoleRef(role),
        roleId: role.id,
        before: null,
      });
    });
    client.on(Events.GuildRoleUpdate, (old, role) => {
      this.#emit('roleUpdate', {
        guildId: role.guildId,
        role: toRoleRef(role),
        roleId: role.id,
        before: old ? toRoleRef(old) : null,
      });
    });
    client.on(Events.GuildRoleDelete, (role, guildId, roleId) => {
      this.#emit('roleDelete', {
        guildId,
        role: null,
        roleId,
        before: role ? toRoleRef(role) : null,
      });
    });

    client.on(Events.ChannelCreate, (channel) => {
      if (!channel.isGuild() || !channel.guildId) return;
      this.#emit('channelCreate', {
        guildId: channel.guildId,
        channel: toChannelRef(channel),
        before: null,
      });
    });
    client.on(Events.ChannelUpdate, (old, channel) => {
      if (!channel.isGuild() || !channel.guildId) return;
      this.#emit('channelUpdate', {
        guildId: channel.guildId,
        channel: toChannelRef(channel),
        before: old.isGuild() ? toChannelRef(old) : null,
      });
    });
    client.on(Events.ChannelDelete, (channel) => {
      if (!channel.isGuild() || !channel.guildId) return;
      this.#emit('channelDelete', {
        guildId: channel.guildId,
        channel: toChannelRef(channel),
        before: null,
      });
    });

    client.on(Events.GuildBanAdd, (ban) =>
      this.#emit('banAdd', { guildId: ban.guildId, user: toUserRef(ban.user) }),
    );
    client.on(Events.GuildBanRemove, (ban) => {
      this.#emit('banRemove', { guildId: ban.guildId, user: toUserRef(ban.user) });
    });

    client.on(Events.VoiceStatesSync, (data) => {
      this.#clearVoice(data.guildId);
      this.#voiceSynced.add(data.guildId);
      for (const state of data.voiceStates) {
        if (state.channel_id) this.#voice.set(`${data.guildId}:${state.user_id}`, state.channel_id);
      }
    });
    client.on(Events.VoiceStateUpdate, (data) => {
      const state = data as WireVoiceState;
      if (!state.guild_id || !state.user_id) return;
      const key = `${state.guild_id}:${state.user_id}`;
      const before = this.#voice.get(key) ?? null;
      const channelId = state.channel_id ?? null;
      if (channelId) this.#voice.set(key, channelId);
      else this.#voice.delete(key);
      if (before === channelId) return;
      this.#emit('voiceUpdate', {
        guildId: state.guild_id,
        userId: state.user_id,
        channelId,
        before,
      });
    });

    client.on(Events.InviteCreate, (invite) => {
      const guildId = invite.guildSnapshot?.id;
      if (!guildId) return;
      this.#emit('inviteCreate', {
        guildId,
        code: invite.code,
        channelId: invite.channelSnapshot?.id ?? null,
        inviterId: invite.inviter?.id ?? null,
      });
    });
    client.on(Events.InviteDelete, (payload) => {
      if (!payload.guildId) return;
      this.#emit('inviteDelete', {
        guildId: payload.guildId,
        code: payload.code,
        channelId: payload.channelId ?? null,
        inviterId: null,
      });
    });

    client.on(Events.GuildAvailable, (guild) => {
      this.#settleVoice(guild.id);
      this.#emit('guildAvailable', toGuildRef(guild));
    });
    client.on(Events.GuildCreate, (guild) => {
      this.#settleVoice(guild.id);
      this.#emit('guildJoin', toGuildRef(guild));
    });
    client.on(Events.GuildDelete, (guild) => {
      if (!guild.available) return;
      this.#emit('guildLeave', guild.id);
    });
  }

  async connect(): Promise<void> {
    await this.#client.login(this.#token);
  }

  async disconnect(): Promise<void> {
    this.#ready = false;
    await this.#client.destroy();
  }

  isReady(): boolean {
    return this.#ready;
  }

  guildCount(): number {
    return this.#client.guilds.size;
  }

  guildIds(): string[] {
    return [...this.#client.guilds.keys()];
  }

  setStatus(text: string): void {
    this.#client.user?.setPresence({ status: 'online', customStatus: { text } });
  }

  gatewayPing(): number | null {
    try {
      const ping = this.#client.ws.ping;
      return ping >= 0 ? Math.round(ping) : null;
    } catch {
      return null;
    }
  }

  async send(channelId: string, message: Outgoing): Promise<string> {
    const prepared = await this.#prepare(channelId, message);
    const sent = await this.#client.channels.send(snowflake(channelId), toSendOptions(prepared));
    this.#scheduleDelete(channelId, sent.id, prepared.deleteAfter);
    return sent.id;
  }

  async reply(message: IncomingMessage, reply: Outgoing): Promise<string> {
    const prepared = await this.#prepare(message.channelId, reply);
    const sent = await this.#client.channels.send(snowflake(message.channelId), {
      ...toSendOptions(prepared),
      replyTo: {
        channelId: message.channelId,
        messageId: message.id,
        guildId: message.guildId ?? undefined,
      },
    });
    this.#scheduleDelete(message.channelId, sent.id, prepared.deleteAfter);
    return sent.id;
  }

  async edit(channelId: string, messageId: string, message: Outgoing): Promise<void> {
    const prepared = await this.#prepare(channelId, message);
    const body: Record<string, unknown> = { content: prepared.content ?? '' };
    if (prepared.embeds) body.embeds = prepared.embeds.map((embed) => toEmbed(embed).toJSON());
    if (prepared.files?.length) {
      const channel = await this.#client.channels.resolve(snowflake(channelId));
      if (!channel.isTextBased()) throw new Error('channel cannot hold attachments');
      body.attachments = await channel.uploadAttachmentsForSend(
        prepared.files.map((file, id) => ({
          id,
          filename: file.name,
          data: file.data,
          contentType: contentTypeOf(file.name),
        })),
      );
    }
    await this.#client.rest.patch(
      Routes.channelMessage(snowflake(channelId), snowflake(messageId)),
      { body },
    );
  }

  async message(channelId: string, messageId: string): Promise<IncomingMessage | null> {
    try {
      const channel = await this.#client.channels.resolve(snowflake(channelId));
      if (!channel.isTextBased()) return null;
      return toIncoming(await channel.messages.fetch(snowflake(messageId)));
    } catch (error) {
      if (isStatus(error, 404) || isStatus(error, 403)) return null;
      throw error;
    }
  }

  async openDirect(userId: string): Promise<string | null> {
    try {
      const dm = await this.#client.rest.post<{ id: string }>(Routes.userMeChannels(), {
        body: { recipient_id: userId },
      });
      return dm.id;
    } catch {
      return null;
    }
  }

  async startThread(channelId: string, messageId: string, name: string): Promise<string> {
    const thread = await this.#client.rest.post<{ id: string }>(
      `/channels/${snowflake(channelId)}/messages/${snowflake(messageId)}/threads`,
      { body: { name: name.slice(0, 100) } },
    );
    return thread.id;
  }

  async delete(channelId: string, messageId: string, reason?: string): Promise<void> {
    await this.#client.rest.delete(
      Routes.channelMessage(snowflake(channelId), snowflake(messageId)),
      {
        headers: auditReason(reason),
      },
    );
  }

  async bulkDelete(channelId: string, messageIds: string[], reason?: string): Promise<number> {
    const ids = [...new Set(messageIds)];
    let deleted = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      if (chunk.length === 1) {
        await this.delete(channelId, chunk[0] as string, reason);
      } else {
        await this.#client.rest.post(Routes.channelBulkDelete(snowflake(channelId)), {
          body: { message_ids: chunk },
          headers: auditReason(reason),
        });
      }
      deleted += chunk.length;
    }
    return deleted;
  }

  async recentMessages(
    channelId: string,
    limit: number,
    before?: string,
  ): Promise<IncomingMessage[]> {
    const channel = await this.#client.channels.resolve(snowflake(channelId));
    if (!channel.isTextBased()) return [];
    const page = await channel.messages.fetch({ limit: Math.min(Math.max(limit, 1), 100), before });
    return [...page.values()].map(toIncoming);
  }

  async sendDirect(userId: string, message: Outgoing): Promise<boolean> {
    const channelId = await this.openDirect(userId);
    if (!channelId) return false;
    try {
      await this.#client.channels.send(
        snowflake(channelId),
        toSendOptions(typeof message === 'string' ? { content: message } : message),
      );
      return true;
    } catch {
      return false;
    }
  }

  async react(channelId: string, messageId: string, emoji: string): Promise<void> {
    await this.#client.rest.put(
      Routes.channelMessageReactionMe(
        snowflake(channelId),
        snowflake(messageId),
        encodeURIComponent(emoji),
      ),
    );
  }

  async unreact(
    channelId: string,
    messageId: string,
    emoji: string,
    userId?: string,
  ): Promise<void> {
    await this.#client.rest.delete(
      `/channels/${snowflake(channelId)}/messages/${snowflake(messageId)}/reactions/${encodeURIComponent(emoji)}/${userId === undefined ? '@me' : snowflake(userId)}`,
    );
  }

  async reactionUsers(
    channelId: string,
    messageId: string,
    emoji: string,
    limit = 100,
    after?: string,
  ): Promise<string[]> {
    const query = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 100)) });
    if (after) query.set('after', after);
    const users = await this.#client.rest.get<{ id: string }[]>(
      `/channels/${snowflake(channelId)}/messages/${snowflake(messageId)}/reactions/${encodeURIComponent(emoji)}?${query}`,
    );
    return users.map((user) => user.id);
  }

  voiceMembers(guildId: string, channelId: string): string[] {
    const prefix = `${guildId}:`;
    const members: string[] = [];
    for (const [key, current] of this.#voice) {
      if (current === channelId && key.startsWith(prefix)) members.push(key.slice(prefix.length));
    }
    return members;
  }

  #clearVoice(guildId: string): void {
    const prefix = `${guildId}:`;
    for (const key of [...this.#voice.keys()]) {
      if (key.startsWith(prefix)) this.#voice.delete(key);
    }
  }

  #settleVoice(guildId: string): void {
    if (!this.#voiceSynced.delete(guildId)) this.#clearVoice(guildId);
  }

  #isBot(userId: string): boolean {
    return this.#client.users.get(userId)?.bot ?? false;
  }

  #scheduleDelete(channelId: string, messageId: string, after: number | undefined): void {
    if (!after) return;
    setTimeout(() => {
      this.delete(channelId, messageId).catch(() => {});
    }, after).unref();
  }

  async #prepare(channelId: string, message: Outgoing): Promise<OutgoingMessage> {
    const out = typeof message === 'string' ? { content: message } : message;
    if (!out.embeds?.length) return out;
    const channel = this.#client.channels.get(channelId);
    if (!channel?.isGuild() || !channel.guildId) return out;
    const granted = await this.#botPermissions(channel.guildId, channelId).catch(() => null);
    if (!granted || hasAll(granted, ['EmbedLinks'])) return out;
    return flatten(out);
  }

  async #botPermissions(guildId: string, channelId: string | null): Promise<PermissionsBitField> {
    const guild = await this.#client.guilds.resolve(snowflake(guildId));
    const me = guild.members.me ?? (await guild.members.fetchMe());
    const channel = channelId ? guild.channels.get(channelId) : undefined;
    return channel ? me.permissionsIn(channel) : me.permissions;
  }

  async user(userId: string): Promise<UserRef | null> {
    try {
      return toUserRef(await this.#client.users.fetch(snowflake(userId)));
    } catch {
      return null;
    }
  }

  async guild(guildId: string): Promise<GuildRef | null> {
    try {
      return toGuildRef(await this.#client.guilds.resolve(snowflake(guildId)));
    } catch {
      return null;
    }
  }

  async member(guildId: string, userId: string): Promise<MemberRef | null> {
    try {
      const guild = await this.#client.guilds.resolve(snowflake(guildId));
      return toMemberRef(await guild.members.resolve(snowflake(userId)));
    } catch {
      return null;
    }
  }

  async isMember(guildId: string, userId: string): Promise<boolean | null> {
    const guild = this.#client.guilds.get(guildId);
    if (!guild) return false;
    if (guild.members.get(userId)) return true;
    try {
      await guild.members.fetch(snowflake(userId));
      return true;
    } catch (error) {
      const cause = typeof error === 'object' && error !== null ? (error as Error).cause : null;
      return isStatus(error, 404) || isStatus(cause, 404) ? false : null;
    }
  }

  async memberRoles(
    guildId: string,
    after: string | null,
    limit: number,
  ): Promise<MemberRoles[] | null> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (after) query.set('after', snowflake(after));
    try {
      const members = await this.#client.rest.get<{ user: { id: string }; roles?: string[] }[]>(
        `${Routes.guildMembers(snowflake(guildId))}?${query}`,
      );
      return members.map((member) => ({ userId: member.user.id, roles: member.roles ?? [] }));
    } catch (error) {
      const cause = typeof error === 'object' && error !== null ? (error as Error).cause : null;
      if ([403, 404].some((status) => isStatus(error, status) || isStatus(cause, status))) {
        return null;
      }
      throw error;
    }
  }

  async roles(guildId: string): Promise<RoleRef[]> {
    const guild = await this.#client.guilds.resolve(snowflake(guildId));
    return [...guild.roles.values()].map(toRoleRef).sort((a, b) => b.position - a.position);
  }

  async channels(guildId: string): Promise<ChannelRef[]> {
    const guild = await this.#client.guilds.resolve(snowflake(guildId));
    return [...guild.channels.values()].map(toChannelRef).sort((a, b) => a.position - b.position);
  }

  async channelInGuild(guildId: string, channelId: string): Promise<boolean> {
    if (this.#client.guilds.get(snowflake(guildId))?.channels.has(channelId)) return true;
    if (!SNOWFLAKE.test(channelId)) return false;
    try {
      const channel = await this.#client.rest.get<{ guild_id?: string | null }>(
        Routes.channel(channelId),
      );
      return channel.guild_id === guildId;
    } catch (error) {
      const cause = typeof error === 'object' && error !== null ? (error as Error).cause : null;
      if ([403, 404].some((status) => isStatus(error, status) || isStatus(cause, status))) {
        return false;
      }
      throw error;
    }
  }

  async welcomeChannel(guildId: string): Promise<string | null> {
    const guild = await this.#client.guilds.resolve(snowflake(guildId));
    const me = guild.members.me ?? (await guild.members.fetchMe());
    const canTalk = (channel: GuildChannel | undefined) =>
      channel !== undefined &&
      channel.type === TEXT_CHANNEL &&
      hasAll(me.permissionsIn(channel), ['SendMessages']);

    const system = guild.systemChannelId ? guild.channels.get(guild.systemChannelId) : undefined;
    if (canTalk(system)) return system?.id ?? null;

    const candidates = [...guild.channels.values()]
      .filter(canTalk)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    return candidates[0]?.id ?? null;
  }

  async ban(guildId: string, userId: string, options: BanOptions = {}): Promise<void> {
    await this.#client.rest.put(Routes.guildBan(snowflake(guildId), snowflake(userId)), {
      body: {
        delete_message_seconds: options.deleteMessageSeconds ?? 0,
        ban_duration_seconds: options.durationSeconds ?? 0,
      },
      headers: auditReason(options.reason),
    });
  }

  async unban(guildId: string, userId: string, reason?: string): Promise<void> {
    await this.#client.rest.delete(Routes.guildBan(snowflake(guildId), snowflake(userId)), {
      headers: auditReason(reason),
    });
  }

  async kick(guildId: string, userId: string, reason?: string): Promise<void> {
    await this.#client.rest.delete(Routes.guildMember(snowflake(guildId), snowflake(userId)), {
      headers: auditReason(reason),
    });
  }

  async timeout(
    guildId: string,
    userId: string,
    until: Date | null,
    reason?: string,
  ): Promise<void> {
    await this.#client.rest.patch(Routes.guildMember(snowflake(guildId), snowflake(userId)), {
      body: {
        communication_disabled_until: until ? until.toISOString() : null,
        timeout_reason: reason ?? null,
      },
      headers: auditReason(reason),
    });
  }

  async addRole(guildId: string, userId: string, roleId: string, reason?: string): Promise<void> {
    await this.#client.rest.put(
      Routes.guildMemberRole(snowflake(guildId), snowflake(userId), snowflake(roleId)),
      {
        headers: auditReason(reason),
      },
    );
  }

  async removeRole(
    guildId: string,
    userId: string,
    roleId: string,
    reason?: string,
  ): Promise<void> {
    await this.#client.rest.delete(
      Routes.guildMemberRole(snowflake(guildId), snowflake(userId), snowflake(roleId)),
      {
        headers: auditReason(reason),
      },
    );
  }

  async setNickname(
    guildId: string,
    userId: string,
    nick: string | null,
    reason?: string,
  ): Promise<void> {
    await this.#client.rest.patch(Routes.guildMember(snowflake(guildId), snowflake(userId)), {
      body: { nick },
      headers: auditReason(reason),
    });
  }

  async guildOwner(guildId: string): Promise<string | null> {
    try {
      return (await this.#client.guilds.resolve(snowflake(guildId))).ownerId ?? null;
    } catch {
      return null;
    }
  }

  async setInvitesPaused(guildId: string, paused: boolean, reason?: string): Promise<boolean> {
    const guild = await this.#client.guilds.resolve(snowflake(guildId));
    const current = (guild.features ?? []).map(String);
    const has = current.includes(INVITES_DISABLED);
    if (has === paused) return false;
    const features = paused
      ? [...current, INVITES_DISABLED]
      : current.filter((feature) => feature !== INVITES_DISABLED);
    await this.#client.rest.patch(Routes.guild(snowflake(guildId)), {
      body: { features },
      headers: auditReason(reason),
    });
    (guild as { features: unknown[] }).features = features;
    return true;
  }

  async moveVoice(guildId: string, userId: string, channelId: string | null): Promise<void> {
    await this.#client.rest.patch(Routes.guildMember(snowflake(guildId), snowflake(userId)), {
      body: { channel_id: channelId },
    });
  }

  async createRole(guildId: string, input: RoleInput, reason?: string): Promise<string> {
    const role = await this.#client.rest.post<{ id: string }>(
      Routes.guildRoles(snowflake(guildId)),
      {
        body: {
          name: input.name,
          color: input.color ?? 0,
          permissions: input.permissionBits ?? bits(input.permissions ?? []),
          hoist: input.hoist ?? false,
          mentionable: input.mentionable ?? false,
        },
        headers: auditReason(reason),
      },
    );
    return role.id;
  }

  async editRole(guildId: string, roleId: string, input: RoleEdit, reason?: string): Promise<void> {
    const permissions =
      input.permissionBits ?? (input.permissions ? bits(input.permissions) : undefined);
    await this.#client.rest.patch(Routes.guildRole(snowflake(guildId), snowflake(roleId)), {
      body: {
        name: input.name,
        color: input.color,
        permissions,
        hoist: input.hoist,
        mentionable: input.mentionable,
      },
      headers: auditReason(reason),
    });
    if (input.position !== undefined) {
      await this.#client.rest.patch(Routes.guildRoles(snowflake(guildId)), {
        body: [{ id: roleId, position: input.position }],
        headers: auditReason(reason),
      });
    }
  }

  async deleteRole(guildId: string, roleId: string, reason?: string): Promise<void> {
    await this.#client.rest.delete(Routes.guildRole(snowflake(guildId), snowflake(roleId)), {
      headers: auditReason(reason),
    });
  }

  async createChannel(guildId: string, input: ChannelInput, reason?: string): Promise<string> {
    const channel = await this.#client.rest.post<{ id: string }>(
      Routes.guildChannels(snowflake(guildId)),
      {
        body: {
          name: input.name,
          type: input.type,
          parent_id: input.parentId ?? null,
          topic: input.topic,
          user_limit: input.userLimit,
          nsfw: input.nsfw,
          rate_limit_per_user: input.rateLimitPerUser,
          permission_overwrites: input.overwrites?.map((overwrite) => toWireOverwrite(overwrite)),
        },
        headers: auditReason(reason),
      },
    );
    return channel.id;
  }

  async editChannel(
    channelId: string,
    input: Partial<ChannelInput> & { rateLimitPerUser?: number },
    reason?: string,
  ): Promise<void> {
    await this.#client.rest.patch(Routes.channel(snowflake(channelId)), {
      body: {
        name: input.name,
        parent_id: input.parentId,
        topic: input.topic,
        user_limit: input.userLimit,
        rate_limit_per_user: input.rateLimitPerUser,
        nsfw: input.nsfw,
        permission_overwrites: input.overwrites?.map((overwrite) => toWireOverwrite(overwrite)),
      },
      headers: auditReason(reason),
    });
  }

  async deleteChannel(channelId: string, reason?: string): Promise<void> {
    await this.#client.rest.delete(Routes.channel(snowflake(channelId)), {
      headers: auditReason(reason),
    });
  }

  async setOverwrite(channelId: string, overwrite: Overwrite, reason?: string): Promise<void> {
    const channel = this.#client.channels.get(channelId);
    const existing = channel?.isGuild()
      ? channel.permissionOverwrites.cache.get(overwrite.id)?.toJSON()
      : undefined;
    const wire = toWireOverwrite(overwrite, existing);
    await this.#client.rest.put(
      Routes.channelPermission(snowflake(channelId), snowflake(overwrite.id)),
      {
        body: { type: wire.type, allow: wire.allow, deny: wire.deny },
        headers: auditReason(reason),
      },
    );
  }

  async deleteOverwrite(channelId: string, overwriteId: string, reason?: string): Promise<void> {
    await this.#client.rest.delete(
      Routes.channelPermission(snowflake(channelId), snowflake(overwriteId)),
      {
        headers: auditReason(reason),
      },
    );
  }

  async hasPermissions(
    guildId: string,
    userId: string,
    channelId: string | null,
    required: readonly Permission[],
  ): Promise<boolean> {
    if (required.length === 0) return true;
    const guild = await this.#client.guilds.resolve(snowflake(guildId));
    if (guild.ownerId === userId) return true;

    const member = await guild.members.resolve(snowflake(userId));
    const channel = channelId ? guild.channels.get(channelId) : undefined;
    const granted = channel ? member.permissionsIn(channel) : member.permissions;
    return hasAll(granted, required);
  }

  async missingBotPermissions(
    guildId: string,
    channelId: string | null,
    required: readonly Permission[],
  ): Promise<Permission[]> {
    const granted = await this.#botPermissions(guildId, channelId);
    if (granted.has(PermissionFlags.Administrator)) return [];
    return required.filter((name) => !granted.has(PermissionFlags[name]));
  }

  async joinSource(guildId: string, userId: string, joinedAt: Date): Promise<JoinSourceLookup> {
    const since = Math.floor(joinedAt.getTime() / 1000) - 5;
    let response: MemberSearchResponse;
    try {
      response = await this.#client.rest.post<MemberSearchResponse>(
        Routes.guildMembersSearch(snowflake(guildId)),
        {
          body: { query: userId, joined_at_gte: since, limit: 10 },
        },
      );
    } catch (error) {
      if (isStatus(error, 403)) return { status: 'forbidden' };
      throw error;
    }

    const hit = response.members.find((member) => member.user_id === userId);
    if (!hit) return { status: 'pending' };
    return {
      status: 'found',
      source: {
        type: hit.supplemental?.join_source_type ?? null,
        inviteCode: hit.supplemental?.source_invite_code ?? null,
        inviterId: hit.supplemental?.inviter_id ?? null,
      },
    };
  }
}

function snowflake(value: string): string {
  if (!SNOWFLAKE.test(value)) throw new Error('invalid snowflake id');
  return value;
}

function auditReason(reason: string | undefined): Record<string, string> | undefined {
  if (!reason) return undefined;
  const value = reason.slice(0, 512);
  return { 'X-Audit-Log-Reason': /^[\x20-\x7e]*$/.test(value) ? value : encodeURIComponent(value) };
}

function bits(list: readonly Permission[]): string {
  return list.reduce((acc, name) => acc | PermissionFlags[name], 0n).toString();
}

const KNOWN_BITS = BigInt(bits(permissions));

function keepUnknown(named: string, existing: string | undefined): string {
  const kept = existing ? BigInt(existing) & ~KNOWN_BITS : 0n;
  return (BigInt(named) | kept).toString();
}

function toWireOverwrite(
  overwrite: Overwrite,
  existing?: { allow: string; deny: string },
): { id: string; type: number; allow: string; deny: string } {
  return {
    id: overwrite.id,
    type: overwrite.type === 'role' ? 0 : 1,
    allow: overwrite.allowBits ?? keepUnknown(bits(overwrite.allow), existing?.allow),
    deny: overwrite.denyBits ?? keepUnknown(bits(overwrite.deny), existing?.deny),
  };
}

function contentTypeOf(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    txt: 'text/plain',
    json: 'application/json',
    ics: 'text/calendar',
    html: 'text/html',
  };
  return (extension && types[extension]) || 'application/octet-stream';
}

function hasAll(granted: PermissionsBitField, required: readonly Permission[]): boolean {
  if (granted.has(PermissionFlags.Administrator)) return true;
  return required.every((name) => granted.has(PermissionFlags[name]));
}

function isStatus(error: unknown, status: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    error.statusCode === status
  );
}

function toUserRef(user: User): UserRef {
  return {
    id: user.id,
    username: user.username,
    displayName: user.globalName ?? user.username,
    bot: user.bot,
    avatarUrl: user.displayAvatarURL({ size: 256 }),
    hasAvatar: user.avatar !== null,
    globalName: user.globalName ?? null,
  };
}

function toMemberRef(member: GuildMember): MemberRef {
  return {
    guildId: member.guild.id,
    user: toUserRef(member.user),
    nick: member.nick,
    roles: [...member.roles.roleIds],
    joinedAt: member.joinedAt ?? null,
    timeoutUntil: member.communicationDisabledUntil,
  };
}

function toRoleRef(role: Role): RoleRef {
  return {
    id: role.id,
    name: role.name,
    color: role.color,
    position: role.position,
    permissions: role._permissions,
    managed: false,
    hoist: role.hoist,
    mentionable: role.mentionable,
  };
}

function toChannelRef(channel: GuildChannel): ChannelRef {
  const extra = channel as GuildChannel & {
    topic?: string | null;
    nsfw?: boolean;
    userLimit?: number | null;
    rateLimitPerUser?: number;
  };
  return {
    id: channel.id,
    guildId: channel.guildId,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId,
    position: channel.position ?? 0,
    topic: extra.topic ?? null,
    nsfw: extra.nsfw ?? false,
    userLimit: extra.userLimit ?? null,
    rateLimitPerUser: extra.rateLimitPerUser ?? 0,
    overwrites: channel.permissionOverwrites.toJSON().map((overwrite) => ({
      id: overwrite.id,
      type: overwrite.type === 1 ? 'member' : 'role',
      allow: overwrite.allow,
      deny: overwrite.deny,
    })),
  };
}

function toGuildRef(guild: Guild): GuildRef {
  return {
    id: guild.id,
    name: guild.name,
    memberCount: guild.memberCount,
    iconUrl: guild.iconURL({ size: 128 }),
  };
}

function toReaction(
  payload: {
    channelId: string;
    messageId: string;
    userId: string;
    emoji: { id?: string; name: string };
    channel: { isGuild(): boolean; guildId?: string | null } | null;
  },
  bot: boolean,
): ReactionEvent {
  const { emoji } = payload;
  const guildId = payload.channel?.isGuild() ? (payload.channel.guildId ?? null) : null;
  return {
    guildId,
    channelId: payload.channelId,
    messageId: payload.messageId,
    userId: payload.userId,
    emoji: emoji.id ? `${emoji.name}:${emoji.id}` : emoji.name,
    bot,
  };
}

function fromEmbed(embed: Message['embeds'][number]): Embed {
  const out: Embed = {};
  if (embed.author?.name)
    out.author = { name: embed.author.name, iconUrl: embed.author.iconUrl ?? undefined };
  if (embed.title) out.title = embed.title;
  if (embed.url) out.url = embed.url;
  if (embed.description) out.description = embed.description;
  if (embed.color !== null) out.color = embed.color;
  if (embed.fields.length)
    out.fields = embed.fields.map(({ name, value, inline }) => ({ name, value, inline }));
  if (embed.footer) {
    out.footer = embed.footer.text;
    if (embed.footer.iconUrl) out.footerIconUrl = embed.footer.iconUrl;
  }
  if (embed.thumbnail) out.thumbnailUrl = embed.thumbnail.url;
  if (embed.image) out.imageUrl = embed.image.url;
  if (embed.timestamp) out.timestamp = embed.timestamp;
  return out;
}

function toIncoming(message: Message): IncomingMessage {
  return {
    id: message.id,
    channelId: message.channelId,
    guildId: message.guildId,
    content: message.content,
    author: toUserRef(message.author),
    memberRoles: message.member ? [...message.member.roles.roleIds] : [],
    fromWebhook: message.webhookId !== null,
    attachments: [...message.attachments.values()].flatMap((attachment) =>
      attachment.url
        ? [
            {
              url: attachment.url,
              filename: attachment.filename,
              contentType: attachment.contentType ?? null,
              size: attachment.size,
            },
          ]
        : [],
    ),
    embeds: (message.embeds ?? []).map(fromEmbed),
    mentionUsers: message.mentions.map((user) => user.id),
    mentionRoles: [...message.mentionRoles],
    mentionEveryone: message.mentionEveryone,
    replyTo: message.messageReference?.messageId ?? null,
    createdAt: message.createdAt,
  };
}

function toEmbed(embed: Embed): EmbedBuilder {
  const builder = new EmbedBuilder();
  if (embed.author) builder.setAuthor({ name: embed.author.name, iconURL: embed.author.iconUrl });
  if (embed.title) builder.setTitle(embed.title);
  if (embed.url) builder.setURL(embed.url);
  if (embed.description) builder.setDescription(embed.description);
  if (embed.color !== undefined) builder.setColor(embed.color);
  if (embed.fields?.length) builder.addFields(...embed.fields);
  if (embed.footer) builder.setFooter({ text: embed.footer, iconURL: embed.footerIconUrl });
  if (embed.thumbnailUrl) builder.setThumbnail(embed.thumbnailUrl);
  if (embed.imageUrl) builder.setImage(embed.imageUrl);
  if (embed.timestamp) builder.setTimestamp(embed.timestamp);
  return builder;
}

function toSendOptions(message: OutgoingMessage): MessageSendOptions {
  return {
    content: message.content,
    embeds: message.embeds?.map(toEmbed),
    files: message.files?.map((file) => ({ name: file.name, data: file.data })),
    allowedMentions: {
      parse: [],
      users: message.mentionUsers ?? [],
      roles: message.mentionRoles ?? [],
      repliedUser: false,
    },
    flags: message.silent ? SUPPRESS_NOTIFICATIONS : undefined,
  };
}
