import { code } from '../../ui/format.js';
import type { BackupsCopy } from './copy.js';

const de: BackupsCopy = {
  commands: {
    backup: 'Snapshots von Rollen, Kanälen und Einstellungen.',
    now: 'Macht einen Snapshot von Rollen, Kanälen und Einstellungen.',
    list: 'Listet die gespeicherten Snapshots auf.',
  },
  kinds: {
    daily: 'täglich',
    manual: 'manuell',
  },
  saved: (number: number, roles: number, channels: number) =>
    `Snapshot #${number} gespeichert, mit **${roles}** Rollen und **${channels}** Kanälen.`,
  listTitle: 'Snapshots',
  listLine: (number: number, kind: string, when: string, roles: number, channels: number) =>
    `\`#${number}\`  ${when}  ${kind}  ${roles} Rollen, ${channels} Kanäle`,
  listLabel: (label: string) => `*${label}*`,
  listFooter: 'Vergleichen und wiederherstellen kannst du sie im Dashboard.',
  empty: (prefix: string) => [
    `Noch keine Snapshots. ${code(`${prefix}backup now`)} macht einen.`,
    `Noch nichts gespeichert. ${code(`${prefix}backup now`)} macht den ersten Snapshot.`,
  ],
  failed:
    'Der Snapshot ist fehlgeschlagen. Prüf, ob ich alle Kanäle und Rollen sehe, und versuch es noch mal.',
};

export default de;
