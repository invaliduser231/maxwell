import { mention } from '../../commands/mentions.js';
import { localized } from '../../i18n/localized.js';
import { count } from '../../ui/format.js';
import de from './copy.de.js';
import es from './copy.es.js';

const en = {
  commands: {
    stats: 'Charts of how active the community is.',
    channels: 'The busiest text and voice channels.',
    members: 'The members who write the most.',
    user: 'How active a member has been.',
  },
  channelsTitle: (days: number) => `Busiest channels, last ${days} days`,
  text: 'Text',
  voice: 'Voice',
  channelLine: (rank: number, channelId: string, value: string) =>
    `${rank}. ${mention.channel(channelId)}  ${value}`,
  messages: (value: number) => `${count(value)} ${value === 1 ? 'message' : 'messages'}`,
  minutes: (value: number) =>
    value >= 120 ? `${count(Math.round(value / 60))} hours` : `${count(value)} min`,
  nothing: 'Nothing counted yet.',
  membersTitle: (days: number) => `Most active members, last ${days} days`,
  memberLine: (rank: number, userId: string, value: string) =>
    `${rank}. ${mention.user(userId)}  ${value}`,
  userTitle: (name: string) => `Activity of ${name}`,
  userLines: (messages: number, days: number, range: number) =>
    `${count(messages)} ${messages === 1 ? 'message' : 'messages'} on ${count(days)} of the last ${range} days.`,
  lastSeen: (when: string) => `Last active ${when}.`,
  quiet: (range: number) => `No messages in the last ${range} days.`,
  others: 'Only moderators can look up other members.',
  failed: 'The chart could not be drawn. Try again in a moment.',
};

export type InsightsCopy = typeof en;

export const copy = localized(en, { de, es });
