import { code } from '../../ui/format.js';
import type { BackupsCopy } from './copy.js';

const es: BackupsCopy = {
  commands: {
    backup: 'Copias de roles, canales y ajustes.',
    now: 'Hace una copia de roles, canales y ajustes.',
    list: 'Muestra las copias guardadas.',
  },
  kinds: {
    daily: 'diaria',
    manual: 'manual',
  },
  saved: (number: number, roles: number, channels: number) =>
    `Copia #${number} guardada con **${roles}** roles y **${channels}** canales.`,
  listTitle: 'Copias',
  listLine: (number: number, kind: string, when: string, roles: number, channels: number) =>
    `\`#${number}\`  ${when}  ${kind}  ${roles} roles, ${channels} canales`,
  listLabel: (label: string) => `*${label}*`,
  listFooter: 'Compáralas y restáuralas en el panel.',
  empty: (prefix: string) => [
    `Todavía no hay copias. ${code(`${prefix}backup now`)} hace una.`,
    `Nada guardado todavía. ${code(`${prefix}backup now`)} hace la primera copia.`,
  ],
  failed: 'La copia falló. Revisa que pueda ver todos los canales y roles, y vuelve a intentarlo.',
};

export default es;
