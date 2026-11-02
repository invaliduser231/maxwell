export const permissions = [
  'Administrator',
  'ManageGuild',
  'ManageChannels',
  'ManageRoles',
  'ManageMessages',
  'ManageNicknames',
  'ManageWebhooks',
  'KickMembers',
  'BanMembers',
  'ModerateMembers',
  'ViewAuditLog',
  'ViewChannel',
  'SendMessages',
  'ReadMessageHistory',
  'EmbedLinks',
  'AttachFiles',
  'AddReactions',
  'MentionEveryone',
  'Connect',
  'MoveMembers',
] as const;

export type Permission = (typeof permissions)[number];

export interface UserRef {
  id: string;
  username: string;
  displayName: string;
  bot: boolean;
  avatarUrl: string;
  hasAvatar?: boolean;
  globalName?: string | null;
}

export interface MemberRef {
  guildId: string;
  user: UserRef;
  nick: string | null;
  roles: string[];
  joinedAt: Date | null;
  timeoutUntil: Date | null;
}

export interface RoleRef {
  id: string;
  name: string;
  color: number;
  position: number;
  permissions: string;
  managed: boolean;
  hoist: boolean;
  mentionable: boolean;
}

export interface RawOverwrite {
  id: string;
  type: 'role' | 'member';
  allow: string;
  deny: string;
}

export interface ChannelRef {
  id: string;
  guildId: string | null;
  name: string | null;
  type: number;
  parentId: string | null;
  position: number;
  topic: string | null;
  nsfw: boolean;
  userLimit: number | null;
  rateLimitPerUser: number;
  overwrites: RawOverwrite[];
}

export const ChannelKind = {
  Text: 0,
  Voice: 2,
  Category: 4,
  Announcement: 5,
  Forum: 15,
} as const;

export interface IncomingMessage {
  id: string;
  channelId: string;
  guildId: string | null;
  content: string;
  author: UserRef;
  memberRoles: string[];
  fromWebhook: boolean;
  attachments: Attachment[];
  embeds: Embed[];
  mentionUsers: string[];
  mentionRoles: string[];
  mentionEveryone: boolean;
  replyTo: string | null;
  createdAt: Date;
}

export interface Attachment {
  url: string;
  filename: string;
  contentType: string | null;
  size: number;
}

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  author?: { name: string; iconUrl?: string };
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  fields?: EmbedField[];
  footer?: string;
  footerIconUrl?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  timestamp?: Date;
}

export interface OutgoingMessage {
  content?: string;
  embeds?: Embed[];
  mentionUsers?: string[];
  mentionRoles?: string[];
  files?: { name: string; data: Uint8Array }[];
  silent?: boolean;
  deleteAfter?: number;
}

export type Outgoing = string | OutgoingMessage;

export interface MemberJoin {
  guildId: string;
  user: UserRef;
  joinedAt: Date;
}

export interface MemberLeave {
  guildId: string;
  userId: string;
  user: UserRef | null;
}

export interface MemberRoles {
  userId: string;
  roles: string[];
}

export interface MemberUpdate {
  guildId: string;
  user: UserRef;
  nick: string | null;
  roles: string[];
  timeoutUntil: Date | null;
  before: { nick: string | null; roles: string[]; timeoutUntil: Date | null } | null;
}

export interface MessageEdit {
  message: IncomingMessage;
  before: string | null;
}

export interface MessageRemoval {
  id: string;
  channelId: string;
  guildId: string | null;
  content: string | null;
  authorId: string | null;
}

export interface BulkRemoval {
  channelId: string;
  guildId: string | null;
  ids: string[];
}

export interface RoleChange {
  guildId: string;
  role: RoleRef | null;
  roleId: string;
  before: RoleRef | null;
}

export interface ChannelChange {
  guildId: string;
  channel: ChannelRef;
  before: ChannelRef | null;
}

export interface BanChange {
  guildId: string;
  user: UserRef;
}

export interface VoiceChange {
  guildId: string;
  userId: string;
  channelId: string | null;
  before: string | null;
}

export interface InviteChange {
  guildId: string;
  code: string;
  channelId: string | null;
  inviterId: string | null;
}

export interface GuildCounts {
  members: number | null;
  online: number | null;
}

export interface GuildRef {
  id: string;
  name: string;
  memberCount: number | null;
  iconUrl: string | null;
}

export interface JoinSource {
  type: number | null;
  inviteCode: string | null;
  inviterId: string | null;
}

export type JoinSourceLookup =
  | { status: 'found'; source: JoinSource }
  | { status: 'pending' }
  | { status: 'forbidden' };

export interface ReactionEvent {
  guildId: string | null;
  channelId: string;
  messageId: string;
  userId: string;
  emoji: string;
  bot: boolean;
}

export const AuditAction = {
  ChannelCreate: 10,
  ChannelUpdate: 11,
  ChannelDelete: 12,
  MemberKick: 20,
  MemberBanAdd: 22,
  MemberBanRemove: 23,
  MemberUpdate: 24,
  MemberRoleUpdate: 25,
  RoleCreate: 30,
  RoleUpdate: 31,
  RoleDelete: 32,
} as const;

export interface AuditLogEvent {
  id: string;
  guildId: string;
  action: number;
  actorId: string | null;
  targetId: string | null;
  reason: string | null;
  changes: { key: string; before: unknown; after: unknown }[];
}

export interface PlatformEvents {
  ready(): void;
  message(message: IncomingMessage): void;
  messageEdit(edit: MessageEdit): void;
  messageRemove(removal: MessageRemoval): void;
  messageBulkRemove(removal: BulkRemoval): void;
  reaction(reaction: ReactionEvent): void;
  reactionRemove(reaction: ReactionEvent): void;
  ownReactionRemove(reaction: ReactionEvent): void;
  memberJoin(join: MemberJoin): void;
  memberLeave(leave: MemberLeave): void;
  memberUpdate(update: MemberUpdate): void;
  roleCreate(change: RoleChange): void;
  roleUpdate(change: RoleChange): void;
  roleDelete(change: RoleChange): void;
  channelCreate(change: ChannelChange): void;
  channelUpdate(change: ChannelChange): void;
  channelDelete(change: ChannelChange): void;
  banAdd(change: BanChange): void;
  banRemove(change: BanChange): void;
  voiceUpdate(change: VoiceChange): void;
  inviteCreate(change: InviteChange): void;
  inviteDelete(change: InviteChange): void;
  auditLog(entry: AuditLogEvent): void;
  guildAvailable(guild: GuildRef): void;
  guildJoin(guild: GuildRef): void;
  guildLeave(guildId: string): void;
}

export interface BanOptions {
  reason?: string;
  deleteMessageSeconds?: number;
  durationSeconds?: number;
}

export interface Overwrite {
  id: string;
  type: 'role' | 'member';
  allow: readonly Permission[];
  deny: readonly Permission[];
  allowBits?: string;
  denyBits?: string;
}

export interface ChannelInput {
  name: string;
  type: number;
  parentId?: string | null;
  topic?: string;
  userLimit?: number;
  nsfw?: boolean;
  rateLimitPerUser?: number;
  overwrites?: Overwrite[];
}

export interface RoleInput {
  name: string;
  color?: number;
  permissions?: readonly Permission[];
  permissionBits?: string;
  hoist?: boolean;
  mentionable?: boolean;
}

export interface RoleEdit extends Partial<RoleInput> {
  position?: number;
}

export interface Platform {
  readonly selfId: string | null;
  on<K extends keyof PlatformEvents>(event: K, listener: PlatformEvents[K]): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isReady(): boolean;
  gatewayPing(): number | null;
  setStatus(text: string): void;
  guildCount(): number;
  guildIds(): string[];

  send(channelId: string, message: Outgoing): Promise<string>;
  reply(message: IncomingMessage, reply: Outgoing): Promise<string>;
  edit(channelId: string, messageId: string, message: Outgoing): Promise<void>;
  delete(channelId: string, messageId: string, reason?: string): Promise<void>;
  bulkDelete(channelId: string, messageIds: string[], reason?: string): Promise<number>;
  recentMessages(channelId: string, limit: number, before?: string): Promise<IncomingMessage[]>;
  message(channelId: string, messageId: string): Promise<IncomingMessage | null>;
  sendDirect(userId: string, message: Outgoing): Promise<boolean>;
  openDirect(userId: string): Promise<string | null>;
  startThread(channelId: string, messageId: string, name: string): Promise<string>;
  react(channelId: string, messageId: string, emoji: string): Promise<void>;
  unreact(channelId: string, messageId: string, emoji: string, userId?: string): Promise<void>;
  reactionUsers(
    channelId: string,
    messageId: string,
    emoji: string,
    limit?: number,
    after?: string,
  ): Promise<string[]>;
  voiceMembers(guildId: string, channelId: string): string[];
  requestCounts(guildIds: readonly string[]): void;
  counts(guildId: string): GuildCounts | null;

  user(userId: string): Promise<UserRef | null>;
  guild(guildId: string): Promise<GuildRef | null>;
  member(guildId: string, userId: string): Promise<MemberRef | null>;
  isMember(guildId: string, userId: string): Promise<boolean | null>;
  memberRoles(guildId: string, after: string | null, limit: number): Promise<MemberRoles[] | null>;
  roles(guildId: string): Promise<RoleRef[]>;
  channels(guildId: string): Promise<ChannelRef[]>;
  channelInGuild(guildId: string, channelId: string): Promise<boolean>;
  welcomeChannel(guildId: string): Promise<string | null>;

  ban(guildId: string, userId: string, options?: BanOptions): Promise<void>;
  unban(guildId: string, userId: string, reason?: string): Promise<void>;
  kick(guildId: string, userId: string, reason?: string): Promise<void>;
  timeout(guildId: string, userId: string, until: Date | null, reason?: string): Promise<void>;
  addRole(guildId: string, userId: string, roleId: string, reason?: string): Promise<void>;
  removeRole(guildId: string, userId: string, roleId: string, reason?: string): Promise<void>;
  setNickname(guildId: string, userId: string, nick: string | null, reason?: string): Promise<void>;
  moveVoice(guildId: string, userId: string, channelId: string | null): Promise<void>;
  guildOwner(guildId: string): Promise<string | null>;
  setInvitesPaused(guildId: string, paused: boolean, reason?: string): Promise<boolean>;

  createRole(guildId: string, input: RoleInput, reason?: string): Promise<string>;
  editRole(guildId: string, roleId: string, input: RoleEdit, reason?: string): Promise<void>;
  deleteRole(guildId: string, roleId: string, reason?: string): Promise<void>;
  createChannel(guildId: string, input: ChannelInput, reason?: string): Promise<string>;
  editChannel(
    channelId: string,
    input: Partial<ChannelInput> & { rateLimitPerUser?: number },
    reason?: string,
  ): Promise<void>;
  deleteChannel(channelId: string, reason?: string): Promise<void>;
  setOverwrite(channelId: string, overwrite: Overwrite, reason?: string): Promise<void>;
  deleteOverwrite(channelId: string, overwriteId: string, reason?: string): Promise<void>;

  hasPermissions(
    guildId: string,
    userId: string,
    channelId: string | null,
    required: readonly Permission[],
  ): Promise<boolean>;
  missingBotPermissions(
    guildId: string,
    channelId: string | null,
    required: readonly Permission[],
  ): Promise<Permission[]>;
  joinSource(guildId: string, userId: string, joinedAt: Date): Promise<JoinSourceLookup>;
}
