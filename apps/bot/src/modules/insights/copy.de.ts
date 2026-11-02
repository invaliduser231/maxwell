import { mention } from '../../commands/mentions.js';
import { count } from '../../ui/format.js';
import type { InsightsCopy } from './copy.js';

const de: InsightsCopy = {
  commands: {
    stats: 'Diagramme dazu, wie aktiv die Community ist.',
    channels: 'Die aktivsten Text- und Voice-Kanäle.',
    members: 'Die Mitglieder, die am meisten schreiben.',
    user: 'Wie aktiv ein Mitglied war.',
  },
  channelsTitle: (days: number) => `Aktivste Kanäle, letzte ${days} Tage`,
  text: 'Text',
  voice: 'Voice',
  channelLine: (rank: number, channelId: string, value: string) =>
    `${rank}. ${mention.channel(channelId)}  ${value}`,
  messages: (value: number) => `${count(value)} ${value === 1 ? 'Nachricht' : 'Nachrichten'}`,
  minutes: (value: number) =>
    value >= 120 ? `${count(Math.round(value / 60))} Stunden` : `${count(value)} Min.`,
  nothing: 'Noch nichts gezählt.',
  membersTitle: (days: number) => `Aktivste Mitglieder, letzte ${days} Tage`,
  memberLine: (rank: number, userId: string, value: string) =>
    `${rank}. ${mention.user(userId)}  ${value}`,
  userTitle: (name: string) => `Aktivität von ${name}`,
  userLines: (messages: number, days: number, range: number) =>
    `${count(messages)} ${messages === 1 ? 'Nachricht' : 'Nachrichten'} an ${count(days)} der letzten ${range} Tage.`,
  lastSeen: (when: string) => `Zuletzt aktiv ${when}.`,
  quiet: (range: number) => `Keine Nachrichten in den letzten ${range} Tagen.`,
  others: 'Andere Mitglieder können nur Moderatoren nachschlagen.',
  failed: 'Das Diagramm ließ sich nicht zeichnen. Versuch es gleich noch mal.',
};

export default de;
