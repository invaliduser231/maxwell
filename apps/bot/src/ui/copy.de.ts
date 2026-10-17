import type { UiCopy } from './copy.js';
import { code } from './format.js';

const de: UiCopy = {
  done: ['Erledigt.', 'Passt.', 'Gespeichert.'],
  missingPermissions: (list: string) => `Dafür brauchst du ${list}.`,
  botMissingPermissions: (list: string, where: string) => `Dafür brauche ich ${list} ${where}.`,
  here: 'hier',
  there: 'dort',
  inCommunity: 'in dieser Community',
  moduleOff: (name: string) => `${name} ist hier aus. Ein Admin kann es im Dashboard einschalten.`,
  guildOnly: 'Das geht nur in einer Community.',
  cooldown: ['Langsam.', 'Eins nach dem anderen.'],
  tryAgain: (when: string) => `Versuch es ${when} noch mal.`,
  failed: (errorCode: string) =>
    `Das hat bei mir nicht geklappt. Gespeichert als ${code(errorCode)}. Versuch es in einer Minute noch mal.`,
  pickOne: 'Such dir eins aus.',
  args: {
    missing: (name: string) => `Mir fehlt noch ${code(name)}.`,
    user: (name: string) => `Für ${code(name)} finde ich niemanden.`,
    channel: 'Diesen Kanal sehe ich nicht.',
    role: 'Diese Rolle gibt es hier nicht.',
    durationMissing: (name: string) =>
      `Mir fehlt noch ${code(name)}, zum Beispiel ${code('10m')} oder ${code('2h')}.`,
    duration: `Diese Dauer kenne ich nicht. Probier ${code('10m')}, ${code('2h')} oder ${code('3d')}.`,
    between: (name: string, min: number, max: number) =>
      `${code(name)} muss zwischen ${min} und ${max} liegen.`,
    whole: (name: string) => `${code(name)} muss eine ganze Zahl sein.`,
  },
  unknownCommand: (typed: string, suggestion: string) =>
    `Einen Befehl ${code(typed)} gibt es nicht. Meintest du ${code(suggestion)}?`,
  prefixHint: (prefix: string) =>
    `Das Prefix hier ist ${code(prefix)}. ${code(`${prefix}help`)} zeigt alles.`,
  prefixAgain: (prefix: string) => `Immer noch da. Immer noch ${code(prefix)}.`,
  prefixThird: 'Ich hab dich schon die ersten zwei Male gehört.',
  page: (index: number, total: number) => `Seite ${index} von ${total}`,
  eggs: {
    demon: 'Nur die thermodynamische Sorte.',
    sort: 'Schnelle nach links, langsame nach rechts. Sortiert.',
    who: 'Maxwell. Ich halte hier Ordnung.',
  },
};

export default de;
