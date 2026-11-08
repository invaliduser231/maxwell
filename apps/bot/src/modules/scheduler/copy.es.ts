import { mention } from '../../commands/mentions.js';
import { code, escapeMarkdown, lines, plural, subtext, timestamp } from '../../ui/format.js';
import type { SchedulerCopy } from './copy.js';

const es: SchedulerCopy = {
  commands: {
    remind: 'Te recuerda algo más tarde.',
    cancel: 'Borra uno de tus recordatorios.',
    reminders: 'Muestra tus recordatorios en esta comunidad.',
  },
  remindersOff: 'Los recordatorios para miembros están desactivados aquí.',
  tooFar: (days: number) =>
    `Un recordatorio puede estar como máximo a ${plural(days, 'día', 'días')}.`,
  tooMany: (max: number, prefix: string) =>
    lines(
      `Ya tienes ${plural(max, 'recordatorio', 'recordatorios')} aquí. Ese es el límite.`,
      subtext(`${prefix}reminders los muestra, ${prefix}reminders cancel <número> borra uno.`),
    ),
  set: (due: Date) => `Te lo recuerdo ${timestamp(due, 'R')}.`,
  setHint: (prefix: string, number: number) =>
    subtext(`Recordatorio ${number}. ${code(`${prefix}reminders cancel ${number}`)} lo borra.`),
  deliver: (userId: string, content: string, createdAt: Date) =>
    lines(
      `${mention.user(userId)} ${content}`,
      subtext(`Lo pediste ${timestamp(createdAt, 'R')}.`),
    ),
  deliverDm: (guildName: string | null, content: string, createdAt: Date) =>
    lines(
      content,
      subtext(
        guildName
          ? `Lo pediste en ${escapeMarkdown(guildName)} ${timestamp(createdAt, 'R')}.`
          : `Lo pediste ${timestamp(createdAt, 'R')}.`,
      ),
    ),
  listTitle: 'Tus recordatorios',
  listLine: (number: number, due: Date, content: string) =>
    `${code(`#${number}`)}  ${timestamp(due, 'R')}  ${content}`,
  listFooter: (prefix: string) => subtext(`${prefix}reminders cancel <número> borra uno.`),
  empty: [
    'No hay recordatorios. Tu yo del futuro tendrá que arreglárselas.',
    'No tienes nada programado aquí.',
    'Ningún recordatorio pendiente.',
  ],
  emptyHint: (prefix: string) => subtext(`${prefix}remind 2h estirar las piernas`),
  cancelled: (number: number) => `El recordatorio ${number} ya no está.`,
  notFound: (number: number) => ({
    content: `No tienes ningún recordatorio ${code(String(number))} aquí.`,
    deleteAfter: 15_000,
  }),
};

export default es;
