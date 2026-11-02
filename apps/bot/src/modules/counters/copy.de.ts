import { mention } from '../../commands/mentions.js';
import { code } from '../../ui/format.js';
import type { CountersCopy } from './copy.js';

const de: CountersCopy = {
  commands: {
    counter: 'Kanalnamen, die mitzählen.',
    add: 'Legt einen Zähler-Kanal an.',
    list: 'Listet die Zähler-Kanäle auf.',
  },
  types: {
    members: 'Mitglieder',
    online: 'Online',
    goal: 'Mitgliederziel',
    voice: 'Im Voice',
    channels: 'Kanäle',
    roles: 'Rollen',
    countdown: 'Countdown',
  },
  templates: {
    members: 'Mitglieder: {count}',
    online: 'Online: {count}',
    goal: 'Ziel: {count} / {goal}',
    voice: 'Im Voice: {count}',
    channels: 'Kanäle: {count}',
    roles: 'Rollen: {count}',
    countdown: 'Noch {count} Tage',
  },
  unknownType: (types: string) => `Such dir einen aus: ${types}.`,
  needsGoal: (prefix: string) =>
    `Ein Ziel braucht eine Zahl, etwa ${code(`${prefix}counter add goal 1000`)}.`,
  needsDate: (prefix: string) =>
    `Ein Countdown braucht ein Datum, etwa ${code(`${prefix}counter add countdown 2027-01-01`)}.`,
  full: (limit: number) => `Diese Community hat schon ${limit} Zähler.`,
  created: (channelId: string) =>
    `${mention.channel(channelId)} zählt jetzt mit. Der Name wird alle paar Minuten aktualisiert.`,
  failed: 'Ich konnte den Kanal nicht anlegen. Prüf, ob ich Kanäle verwalten darf.',
  listTitle: 'Zähler',
  listLine: (channelId: string, type: string) => `${mention.channel(channelId)}  ${type}`,
  empty: (prefix: string) => [
    `Noch keine Zähler. ${code(`${prefix}counter add members`)} legt einen an.`,
    `Hier zählt noch nichts. Probier ${code(`${prefix}counter add members`)}.`,
  ],
};

export default de;
