import { localized } from '../i18n/localized.js';
import de from './copy.de.js';
import es from './copy.es.js';

const en = {
  level: 'Level',
  rank: 'Rank',
  levelWord: 'Level ',
  unlocked: 'Unlocked ',
  digest: {
    title: 'Weekly digest',
    range: (from: string, to: string) => `${from} to ${to}`,
    joins: 'Joins',
    leaves: 'Leaves',
    net: 'Net change',
    messages: 'Messages',
    active: 'Active members',
    inbox: 'Open in inbox',
    channels: 'Busiest channels',
    noMessages: 'No messages counted',
    deletedChannel: 'Deleted channel',
    moderation: 'Moderation',
    warn: 'Warns',
    timeout: 'Timeouts',
    kick: 'Kicks',
    ban: 'Bans',
    same: 'Same as last week',
    versus: (change: string) => `${change} vs last week`,
  },
  activity: {
    title: (days: number) => `Last ${days} days`,
    range: (from: string, to: string) => `${from} to ${to}`,
    messages: 'Messages',
    active: 'Active members',
    members: 'Member change',
    voice: 'Hours in voice',
    perDay: 'Messages per day',
    peak: (count: string) => `Busiest day: ${count}`,
    empty: 'No messages counted',
    flow: 'Joins and leaves',
    joined: (count: string) => `${count} joined`,
    left: (count: string) => `${count} left`,
  },
};

export type CardCopy = typeof en;

export const cardCopy = localized(en, { de, es });
