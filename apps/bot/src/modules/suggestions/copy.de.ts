import { mention } from '../../commands/mentions.js';
import { bold, count, truncate } from '../../ui/format.js';
import type { SuggestionsCopy } from './copy.js';

const de: SuggestionsCopy = {
  statusNames: {
    open: 'Offen',
    planned: 'Geplant',
    done: 'Umgesetzt',
    declined: 'Abgelehnt',
  },
  suggestDescription: 'Postet einen Vorschlag, über den alle abstimmen können.',
  title: (id: string) => `Vorschlag ${id}`,
  status: (name: string) => `**Status** ${name}`,
  reason: (reason: string) => `**Begründung** ${reason}`,
  votes: (up: number, down: number) => `**Stimmen** ${count(up)} dafür, ${count(down)} dagegen`,
  author: (name: string, username: string) => `${name} (@${username})`,
  threadName: (id: string, content: string) =>
    truncate(`${id}: ${content.replace(/\s+/g, ' ').trim()}`, 100),

  posted: (channelId: string) => `Steht jetzt in ${mention.channel(channelId)}.`,
  inChannel: (channelId: string) => `in ${mention.channel(channelId)}`,
  noChannel:
    'Für Vorschläge gibt es noch keinen Kanal. Ein Admin kann im Dashboard einen auswählen.',
  channelGone:
    'Der Kanal für Vorschläge ist weg. Ein Admin kann im Dashboard einen neuen auswählen.',
  tooLong: 'Höchstens 2.000 Zeichen.',
  empty: 'Mir fehlt der Vorschlag selbst.',

  statusDirect: (number: number, server: string, name: string, content: string) =>
    `Dein Vorschlag ${number} in ${bold(server)} ist jetzt ${bold(name)}.\n> ${truncate(content.replace(/\s+/g, ' '), 200)}`,
  statusDirectReason: (reason: string) => `**Begründung** ${reason}`,
};

export default de;
