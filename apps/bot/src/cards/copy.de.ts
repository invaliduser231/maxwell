import type { CardCopy } from './copy.js';

const de: CardCopy = {
  level: 'Level',
  rank: 'Rang',
  levelWord: 'Level ',
  unlocked: 'Freigeschaltet: ',
  digest: {
    title: 'Wochenbericht',
    range: (from: string, to: string) => `${from} bis ${to}`,
    joins: 'Beitritte',
    leaves: 'Austritte',
    net: 'Veränderung',
    messages: 'Nachrichten',
    active: 'Aktive Mitglieder',
    inbox: 'Offen in der Inbox',
    channels: 'Aktivste Kanäle',
    noMessages: 'Keine Nachrichten gezählt',
    deletedChannel: 'Gelöschter Kanal',
    moderation: 'Moderation',
    warn: 'Verwarnungen',
    timeout: 'Timeouts',
    kick: 'Kicks',
    ban: 'Bans',
    same: 'Wie letzte Woche',
    versus: (change: string) => `${change} zur Vorwoche`,
  },
};

export default de;
