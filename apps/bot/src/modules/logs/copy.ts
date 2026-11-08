import { localized } from '../../i18n/localized.js';
import { count, plural } from '../../ui/format.js';
import de from './copy.de.js';
import es from './copy.es.js';

const en = {
  titles: {
    messageDelete: 'Message deleted',
    messageEdit: 'Message edited',
    messageBulkDelete: 'Messages deleted in bulk',
    memberJoin: 'Member joined',
    botJoin: 'Bot added',
    memberLeave: 'Member left',
    memberRoles: 'Roles changed',
    nickname: 'Nickname changed',
    timeoutSet: 'Member timed out',
    timeoutCleared: 'Timeout removed',
    roleCreate: 'Role created',
    roleUpdate: 'Role updated',
    roleDelete: 'Role deleted',
    channelCreate: 'Channel created',
    channelUpdate: 'Channel updated',
    channelDelete: 'Channel deleted',
    threadCreate: 'Thread created',
    threadUpdate: 'Thread updated',
    threadDelete: 'Thread deleted',
    voiceJoin: 'Joined voice',
    voiceLeave: 'Left voice',
    voiceMove: 'Moved voice',
    inviteCreate: 'Invite created',
    inviteDelete: 'Invite deleted',
    ban: 'Member banned',
    unban: 'Member unbanned',
    kick: 'Member kicked',
  },

  labels: {
    before: 'Before',
    after: 'After',
    added: 'Added',
    removed: 'Removed',
    name: 'Name',
    color: 'Color',
    permissions: 'Permissions',
    category: 'Category',
    parent: 'In',
    type: 'Type',
    accountCreated: 'Account created',
    channel: 'Channel',
    inviter: 'Created by',
    until: 'Until',
    attachments: 'Attachments',
    hoist: 'Shown separately',
    mentionable: 'Mentionable',
    by: 'By',
    reason: 'Reason',
  },

  inChannel: (channel: string, sent: string | null) =>
    sent ? `in ${channel}, sent ${sent}` : `in ${channel}`,
  unknownContent: "The text wasn't in my cache.",
  emptyContent: 'No text.',
  noNickname: '*no nickname*',
  noCategory: '*no category*',
  youngAccount: (age: string) => `The account is only ${age} old.`,
  age: (ms: number) => {
    const hours = Math.floor(ms / 3_600_000);
    if (hours < 1) return plural(Math.max(Math.floor(ms / 60_000), 1), 'minute');
    if (hours < 48) return plural(hours, 'hour');
    return plural(Math.floor(hours / 24), 'day');
  },
  bulkSummary: (n: number, channel: string) => `**${count(n)}** messages in ${channel}`,
  bulkCached: (known: number, total: number) =>
    known === 0
      ? 'None of them were in my cache.'
      : known === total
        ? 'The text of all of them is attached.'
        : `The text of ${count(known)} of them is attached.`,
  bulkFile: 'deleted-messages.txt',
  bulkUnknownAuthor: 'unknown',
  voiceJoined: (user: string, channel: string) => `${user} joined ${channel}.`,
  voiceLeft: (user: string, channel: string) => `${user} left ${channel}.`,
  voiceMoved: (user: string, from: string, to: string) => `${user} moved from ${from} to ${to}.`,
  inviteLine: (code: string, channel: string | null) =>
    channel ? `\`${code}\` for ${channel}` : `\`${code}\``,
  memberCount: (n: number) => `Member #${count(n)}`,
  userFooter: (id: string) => `User ${id}`,
  messageFooter: (userId: string | null, messageId: string) =>
    userId ? `User ${userId} / Message ${messageId}` : `Message ${messageId}`,
  roleFooter: (id: string) => `Role ${id}`,
  channelFooter: (id: string) => `Channel ${id}`,
  timeoutUntil: (when: string, relative: string) => `${when} (${relative})`,
  change: (label: string, before: string, after: string) => `**${label}** ${before} to ${after}`,
  permissionsChanged: 'Changed',
  more: (n: number) => `and ${plural(n, 'more', 'more')}`,
  testNote: 'This is a test entry. Real entries look like this.',

  channelTypes: {
    0: 'Text',
    2: 'Voice',
    4: 'Category',
    5: 'Announcement',
    10: 'Announcement thread',
    11: 'Thread',
    12: 'Private thread',
    15: 'Forum',
    16: 'Media',
  } as Record<number, string>,
};

export type LogsCopy = typeof en;

export const copy = localized(en, { de, es });
