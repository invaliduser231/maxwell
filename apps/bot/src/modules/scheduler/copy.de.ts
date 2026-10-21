import { mention } from '../../commands/mentions.js';
import { code, escapeMarkdown, lines, plural, subtext, timestamp } from '../../ui/format.js';
import type { SchedulerCopy } from './copy.js';

const de: SchedulerCopy = {
  commands: {
    remind: 'Erinnert dich später an etwas.',
    cancel: 'Löscht eine deiner Erinnerungen.',
    reminders: 'Zeigt deine Erinnerungen in dieser Community.',
  },
  remindersOff: 'Erinnerungen für Mitglieder sind hier aus.',
  tooFar: (days: number) =>
    `Eine Erinnerung darf höchstens ${plural(days, 'Tag', 'Tage')} in der Zukunft liegen.`,
  tooMany: (max: number, prefix: string) =>
    lines(
      `Du hast hier schon ${plural(max, 'Erinnerung', 'Erinnerungen')}. Mehr geht nicht.`,
      subtext(`${prefix}reminders zeigt sie, ${prefix}reminders cancel <nummer> löscht eine.`),
    ),
  set: (due: Date) => `Ich erinnere dich ${timestamp(due, 'R')}.`,
  setHint: (prefix: string, number: number) =>
    subtext(`Erinnerung ${number}. ${code(`${prefix}reminders cancel ${number}`)} löscht sie.`),
  deliver: (userId: string, content: string, createdAt: Date) =>
    lines(
      `${mention.user(userId)} ${content}`,
      subtext(`Darum hast du ${timestamp(createdAt, 'R')} gebeten.`),
    ),
  deliverDm: (guildName: string | null, content: string, createdAt: Date) =>
    lines(
      content,
      subtext(
        guildName
          ? `Darum hast du ${timestamp(createdAt, 'R')} in ${escapeMarkdown(guildName)} gebeten.`
          : `Darum hast du ${timestamp(createdAt, 'R')} gebeten.`,
      ),
    ),
  listTitle: 'Deine Erinnerungen',
  listLine: (number: number, due: Date, content: string) =>
    `${code(`#${number}`)}  ${timestamp(due, 'R')}  ${content}`,
  listFooter: (prefix: string) => subtext(`${prefix}reminders cancel <nummer> löscht eine.`),
  empty: [
    'Keine Erinnerungen. Dein zukünftiges Ich ist auf sich gestellt.',
    'Für dich ist hier nichts geplant.',
    'Keine Erinnerungen offen.',
  ],
  emptyHint: (prefix: string) => subtext(`${prefix}remind 2h kurz die Beine vertreten`),
  cancelled: (number: number) => `Erinnerung ${number} ist gelöscht.`,
  notFound: (number: number) => ({
    content: `Du hast hier keine Erinnerung ${code(String(number))}.`,
    deleteAfter: 15_000,
  }),
};

export default de;
