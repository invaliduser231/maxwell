import { localized } from '../i18n/localized.js';
import de from './copy.de.js';

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
};

export type CardCopy = typeof en;

export const cardCopy = localized(en, { de });
