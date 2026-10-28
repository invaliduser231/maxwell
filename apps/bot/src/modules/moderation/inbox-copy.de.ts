import { count } from '../../ui/format.js';
import type { InboxCopy } from './inbox-copy.js';

const de: InboxCopy = {
  command:
    'Schickt eine Nachricht oder ein Mitglied an die Moderation. Antworte auf die Nachricht oder nenne das Mitglied.',
  sent: 'Ist bei der Moderation.',
  already: 'Das hast du schon gemeldet.',
  nothing: 'Antworte auf die Nachricht, die du melden willst, oder nenne das Mitglied.',
  self: 'Dich selbst kannst du nicht melden.',
  bot: 'Bots werden nicht gemeldet, frag eine Moderatorin oder einen Moderator.',
  off: 'Meldungen sind hier ausgeschaltet.',
  reactionSent: (server: string) => `Deine Meldung in **${server}** ist bei der Moderation.`,
  titles: {
    report: (n: number) => `Meldung #${n}`,
    appeal: (n: number) => `Einspruch #${n}`,
    review: (n: number) => `Prüfung #${n}`,
  },
  fields: {
    member: 'Mitglied',
    reporters: 'Gemeldet von',
    message: 'Nachricht',
    report: 'Meldung',
    appeal: 'Einspruch',
    review: 'Grund',
    status: 'Status',
    outcome: 'Ergebnis',
    note: 'Notiz',
  },
  reporters: (n: number) => (n === 1 ? '1 Mitglied' : `${count(n)} Mitgliedern`),
  jump: 'Zur Nachricht',
  gone: 'Gelöscht',
  dashboard: 'Im Dashboard öffnen',
  status: {
    open: 'Offen',
    claimed: (who: string) => `Übernommen von ${who}`,
    resolved: (who: string) => `Erledigt von ${who}`,
    dismissed: (who: string) => `Verworfen von ${who}`,
  },
  outcomes: {
    warn: (n: number) => `Verwarnt, Fall #${n}`,
    timeout: (n: number) => `Timeout, Fall #${n}`,
    kick: (n: number) => `Gekickt, Fall #${n}`,
    ban: (n: number) => `Gebannt, Fall #${n}`,
    unban: (n: number) => `Entbannt, Fall #${n}`,
    approved: 'Bestätigt',
    declined: 'Abgelehnt',
    deleted: 'Nachricht gelöscht',
    none: 'Nichts unternommen',
  },
  appealAccepted: (server: string) =>
    `Dein Einspruch in **${server}** wurde angenommen. Mit einer Einladung kannst du wieder beitreten.`,
  appealDeclined: (server: string) => `Dein Einspruch in **${server}** wurde abgelehnt.`,
  more: (n: number) => `und ${count(n)} weitere`,
  appealLine: (url: string) => `Einspruch einlegen kannst du hier: ${url}`,
};

export default de;
