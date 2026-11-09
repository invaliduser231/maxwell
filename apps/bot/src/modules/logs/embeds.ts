import { mention } from '../../commands/mentions.js';
import type {
  AuditLogEvent,
  ChannelChange,
  Embed,
  InviteChange,
  MessageEdit,
  RoleChange,
  RoleRef,
  UserRef,
} from '../../platform/types.js';
import { code, lines, snowflakeDate, timestamp, truncate } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { permissionNames } from '../../ui/voice.js';
import type { CachedMessage } from './cache.js';
import { copy } from './copy.js';
import { permissionDiff } from './permissions.js';

const CONTENT_MAX = 1_000;
const LIST_MAX = 15;
const NEW_ACCOUNT = 7 * 86_400_000;

export interface Person {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string;
}

export function personFromUser(user: UserRef): Person {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    avatarUrl: user.avatarUrl,
  };
}

export function personFromCache(message: CachedMessage): Person {
  return {
    id: message.authorId,
    displayName: message.authorName,
    username: message.authorUsername,
    avatarUrl: message.avatarUrl,
  };
}

function author(person: Person | null): Embed['author'] {
  if (!person) return undefined;
  const name =
    person.displayName === person.username
      ? `@${person.username}`
      : `${person.displayName} (@${person.username})`;
  return { name, iconUrl: person.avatarUrl };
}

export function quote(text: string, max = CONTENT_MAX): string {
  return truncate(text, max)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function list(items: readonly string[]): string {
  if (items.length <= LIST_MAX) return items.join(', ');
  return `${items.slice(0, LIST_MAX).join(', ')} ${copy.more(items.length - LIST_MAX)}`;
}

export function deletedEmbed(input: {
  messageId: string;
  channelId: string;
  authorId: string | null;
  person: Person | null;
  content: string | null;
  attachments: readonly string[];
}): Embed {
  const sent = timestamp(snowflakeDate(input.messageId), 'R');
  const body =
    input.content === null
      ? copy.unknownContent
      : input.content.trim()
        ? quote(input.content)
        : input.attachments.length
          ? null
          : copy.emptyContent;
  return {
    color: palette.danger,
    author: author(input.person),
    title: copy.titles.messageDelete,
    description: lines(
      body,
      input.attachments.length > 0 &&
        `**${copy.labels.attachments}** ${list(input.attachments.map((name) => code(name)))}`,
      '',
      copy.inChannel(mention.channel(input.channelId), sent),
    ),
    footer: copy.messageFooter(input.authorId, input.messageId),
    timestamp: new Date(),
  };
}

export function editedEmbed(edit: MessageEdit, before: string): Embed {
  const { message } = edit;
  return {
    color: palette.south,
    author: author(personFromUser(message.author)),
    title: copy.titles.messageEdit,
    description: lines(
      `**${copy.labels.before}**`,
      before.trim() ? quote(before, 900) : copy.emptyContent,
      `**${copy.labels.after}**`,
      message.content.trim() ? quote(message.content, 900) : copy.emptyContent,
      '',
      copy.inChannel(mention.channel(message.channelId), timestamp(message.createdAt, 'R')),
    ),
    footer: copy.messageFooter(message.author.id, message.id),
    timestamp: new Date(),
  };
}

export function bulkEmbed(channelId: string, total: number, known: number): Embed {
  return {
    color: palette.danger,
    title: copy.titles.messageBulkDelete,
    description: lines(
      copy.bulkSummary(total, mention.channel(channelId)),
      copy.bulkCached(known, total),
    ),
    footer: copy.channelFooter(channelId),
    timestamp: new Date(),
  };
}

export function bulkTranscript(messages: readonly CachedMessage[]): string {
  return [...messages]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((message) => {
      const files = message.attachments.length ? ` [${message.attachments.join(', ')}]` : '';
      return `[${message.createdAt.toISOString()}] ${message.authorUsername} (${message.authorId}): ${message.content}${files}`;
    })
    .join('\n');
}

export function joinEmbed(input: {
  user: UserRef;
  memberCount: number | null;
  warnIcon: string;
  now?: number;
}): Embed {
  const created = snowflakeDate(input.user.id);
  const age = (input.now ?? Date.now()) - created.getTime();
  return {
    color: palette.success,
    author: author(personFromUser(input.user)),
    title: input.user.bot ? copy.titles.botJoin : copy.titles.memberJoin,
    description: lines(
      mention.user(input.user.id),
      `**${copy.labels.accountCreated}** ${timestamp(created, 'R')}`,
      age < NEW_ACCOUNT && `${input.warnIcon}${copy.youngAccount(copy.age(age))}`,
    ),
    footer: [
      input.memberCount ? copy.memberCount(input.memberCount) : null,
      copy.userFooter(input.user.id),
    ]
      .filter(Boolean)
      .join(' / '),
    timestamp: new Date(),
  };
}

export function leaveEmbed(userId: string, user: UserRef | null): Embed {
  return {
    color: palette.muted,
    author: author(user ? personFromUser(user) : null),
    title: copy.titles.memberLeave,
    description: lines(
      mention.user(userId),
      `**${copy.labels.accountCreated}** ${timestamp(snowflakeDate(userId), 'R')}`,
    ),
    footer: copy.userFooter(userId),
    timestamp: new Date(),
  };
}

export function memberRolesEmbed(
  user: UserRef,
  added: readonly string[],
  removed: readonly string[],
): Embed | null {
  if (added.length === 0 && removed.length === 0) return null;
  return {
    color: palette.south,
    author: author(personFromUser(user)),
    title: copy.titles.memberRoles,
    description: lines(
      mention.user(user.id),
      added.length > 0 && `**${copy.labels.added}** ${list(added.map(mention.role))}`,
      removed.length > 0 && `**${copy.labels.removed}** ${list(removed.map(mention.role))}`,
    ),
    footer: copy.userFooter(user.id),
    timestamp: new Date(),
  };
}

export function nicknameEmbed(user: UserRef, before: string | null, after: string | null): Embed {
  return {
    color: palette.south,
    author: author(personFromUser(user)),
    title: copy.titles.nickname,
    description: lines(
      mention.user(user.id),
      `**${copy.labels.before}** ${before ? code(before) : copy.noNickname}`,
      `**${copy.labels.after}** ${after ? code(after) : copy.noNickname}`,
    ),
    footer: copy.userFooter(user.id),
    timestamp: new Date(),
  };
}

export function timeoutEmbed(user: UserRef, until: Date | null): Embed {
  return {
    color: until ? palette.warning : palette.success,
    author: author(personFromUser(user)),
    title: until ? copy.titles.timeoutSet : copy.titles.timeoutCleared,
    description: lines(
      mention.user(user.id),
      until &&
        `**${copy.labels.until}** ${copy.timeoutUntil(timestamp(until, 'f'), timestamp(until, 'R'))}`,
    ),
    footer: copy.userFooter(user.id),
    timestamp: new Date(),
  };
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0').toUpperCase()}`;
}

function permissionLines(before: string, after: string): string[] {
  const diff = permissionDiff(before, after);
  const out: string[] = [];
  if (diff.added.length)
    out.push(`**${copy.labels.added}** ${diff.added.map((p) => permissionNames[p]).join(', ')}`);
  if (diff.removed.length)
    out.push(
      `**${copy.labels.removed}** ${diff.removed.map((p) => permissionNames[p]).join(', ')}`,
    );
  if (!out.length && diff.other)
    out.push(`**${copy.labels.permissions}** ${copy.permissionsChanged}`);
  return out;
}

export function roleEmbed(kind: 'create' | 'update' | 'delete', change: RoleChange): Embed | null {
  const role: RoleRef | null = change.role ?? change.before;
  const name = role ? code(role.name) : code(change.roleId);
  const base = {
    footer: copy.roleFooter(change.roleId),
    timestamp: new Date(),
  };
  if (kind === 'create') {
    return {
      ...base,
      color: palette.south,
      title: copy.titles.roleCreate,
      description: lines(role ? `${mention.role(role.id)} ${name}` : name),
    };
  }
  if (kind === 'delete') {
    return {
      ...base,
      color: palette.danger,
      title: copy.titles.roleDelete,
      description: name,
    };
  }
  const before = change.before;
  const after = change.role;
  if (!before || !after) return null;
  const changes: string[] = [];
  if (before.name !== after.name)
    changes.push(copy.change(copy.labels.name, code(before.name), code(after.name)));
  if (before.color !== after.color)
    changes.push(copy.change(copy.labels.color, hex(before.color), hex(after.color)));
  if (before.permissions !== after.permissions)
    changes.push(...permissionLines(before.permissions, after.permissions));
  if (changes.length === 0) return null;
  return {
    ...base,
    color: palette.south,
    title: copy.titles.roleUpdate,
    description: lines(`${mention.role(after.id)} ${code(after.name)}`, ...changes),
  };
}

const THREAD_TYPES = new Set([10, 11, 12]);

export function channelEmbed(
  kind: 'create' | 'update' | 'delete',
  change: ChannelChange,
): Embed | null {
  const { channel } = change;
  const label = channel.name ? code(channel.name) : code(channel.id);
  const type = (copy.channelTypes as Record<number, string | undefined>)[channel.type];
  const base = { footer: copy.channelFooter(channel.id), timestamp: new Date() };
  const parent = (id: string | null) => (id ? mention.channel(id) : copy.noCategory);
  const thread = THREAD_TYPES.has(channel.type);
  const parentLabel = thread ? copy.labels.parent : copy.labels.category;
  const titles = thread
    ? {
        create: copy.titles.threadCreate,
        update: copy.titles.threadUpdate,
        delete: copy.titles.threadDelete,
      }
    : {
        create: copy.titles.channelCreate,
        update: copy.titles.channelUpdate,
        delete: copy.titles.channelDelete,
      };
  if (kind === 'create') {
    return {
      ...base,
      color: palette.south,
      title: titles.create,
      description: lines(
        `${mention.channel(channel.id)} ${label}`,
        type && `**${copy.labels.type}** ${type}`,
        channel.parentId && `**${parentLabel}** ${parent(channel.parentId)}`,
      ),
    };
  }
  if (kind === 'delete') {
    return {
      ...base,
      color: palette.danger,
      title: titles.delete,
      description: lines(label, type && `**${copy.labels.type}** ${type}`),
    };
  }
  const before = change.before;
  if (!before) return null;
  const changes: string[] = [];
  if (before.name !== channel.name)
    changes.push(copy.change(copy.labels.name, code(before.name ?? ''), code(channel.name ?? '')));
  if (before.parentId !== channel.parentId)
    changes.push(copy.change(parentLabel, parent(before.parentId), parent(channel.parentId)));
  if (changes.length === 0) return null;
  return {
    ...base,
    color: palette.south,
    title: titles.update,
    description: lines(mention.channel(channel.id), ...changes),
  };
}

export function voiceEmbed(input: {
  userId: string;
  person: Person | null;
  channelId: string | null;
  before: string | null;
}): Embed | null {
  const who = mention.user(input.userId);
  let title: string;
  let text: string;
  let color: number = palette.south;
  if (input.channelId && input.before) {
    title = copy.titles.voiceMove;
    text = copy.voiceMoved(who, mention.channel(input.before), mention.channel(input.channelId));
  } else if (input.channelId) {
    title = copy.titles.voiceJoin;
    text = copy.voiceJoined(who, mention.channel(input.channelId));
    color = palette.success;
  } else if (input.before) {
    title = copy.titles.voiceLeave;
    text = copy.voiceLeft(who, mention.channel(input.before));
    color = palette.muted;
  } else {
    return null;
  }
  return {
    color,
    author: author(input.person),
    title,
    description: text,
    footer: copy.userFooter(input.userId),
    timestamp: new Date(),
  };
}

export function inviteEmbed(kind: 'create' | 'delete', change: InviteChange): Embed {
  return {
    color: kind === 'create' ? palette.south : palette.muted,
    title: kind === 'create' ? copy.titles.inviteCreate : copy.titles.inviteDelete,
    description: lines(
      copy.inviteLine(change.code, change.channelId ? mention.channel(change.channelId) : null),
      change.inviterId && `**${copy.labels.inviter}** ${mention.user(change.inviterId)}`,
    ),
    footer: change.inviterId ? copy.userFooter(change.inviterId) : undefined,
    timestamp: new Date(),
  };
}

export function banEmbed(kind: 'ban' | 'unban', user: UserRef): Embed {
  return {
    color: kind === 'ban' ? palette.danger : palette.success,
    author: author(personFromUser(user)),
    title: kind === 'ban' ? copy.titles.ban : copy.titles.unban,
    description: mention.user(user.id),
    footer: copy.userFooter(user.id),
    timestamp: new Date(),
  };
}

export function actorLines(entry: Pick<AuditLogEvent, 'actorId' | 'reason'> | null): string[] {
  if (!entry) return [];
  const out: string[] = [];
  if (entry.actorId) out.push(`**${copy.labels.by}** ${mention.user(entry.actorId)}`);
  const reason = entry.reason?.trim();
  if (reason) out.push(`**${copy.labels.reason}** ${truncate(reason, 500)}`);
  return out;
}

export function withActor(
  embed: Embed,
  entry: Pick<AuditLogEvent, 'actorId' | 'reason'> | null,
): Embed {
  const extra = actorLines(entry);
  if (extra.length === 0) return embed;
  return { ...embed, description: lines(embed.description ?? null, ...extra) };
}

export function kickEmbed(
  userId: string,
  user: UserRef | null,
  entry: Pick<AuditLogEvent, 'actorId' | 'reason'>,
): Embed {
  return {
    color: palette.danger,
    author: author(user ? personFromUser(user) : null),
    title: copy.titles.kick,
    description: lines(mention.user(userId), ...actorLines(entry)),
    footer: copy.userFooter(userId),
    timestamp: new Date(),
  };
}

export function roleDiff(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } {
  return {
    added: after.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !after.includes(id)),
  };
}
