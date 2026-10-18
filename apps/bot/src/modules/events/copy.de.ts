import { mention } from '../../commands/mentions.js';
import {
  bold,
  code,
  count,
  escapeMarkdown,
  lines,
  plural,
  subtext,
  timestamp,
} from '../../ui/format.js';
import { andList } from '../../ui/voice.js';
import type { EventsCopy } from './copy.js';

const weekdayLabels: Record<string, string> = {
  mon: 'Montag',
  tue: 'Dienstag',
  wed: 'Mittwoch',
  thu: 'Donnerstag',
  fri: 'Freitag',
  sat: 'Samstag',
  sun: 'Sonntag',
};

const statusWords: Record<string, string> = {
  cancelled: 'abgesagt',
  ended: 'vorbei',
};

const de: EventsCopy = {
  commands: {
    event: 'Kommende Events und neue planen.',
    create: 'Plant ein Event mit Zusagen per Reaktion.',
    list: 'Zeigt die kommenden Events.',
    cancel: 'Sagt ein Event ab.',
    poll: 'Startet eine Umfrage mit Zahlen-Reaktionen.',
  },
  when: {
    missing: 'Dafür brauche ich eine Zeit und einen Titel.',
    invalid: `Mit dieser Zeit kann ich nichts anfangen. Versuch ${code('fr 20:00')}, ${code('2026-11-02 19:30')} oder ${code('in 3h')}.`,
    past: 'Diese Zeit ist schon vorbei.',
    title: 'Das Event braucht einen Titel.',
    long: 'Der Titel darf höchstens 200 Zeichen haben, die Beschreibung höchstens 2.000.',
  },
  created: (title: string, startsAt: Date, channelId: string) =>
    `${bold(title)} ist am ${timestamp(startsAt, 'F')}. Steht in ${mention.channel(channelId)}.`,
  createdHint: (prefix: string, number: number) =>
    subtext(`Event ${number}. ${code(`${prefix}event cancel ${number}`)} sagt es ab.`),
  noChannel: 'Es ist kein Event-Kanal eingerichtet, und hier darf ich nicht posten.',
  listTitle: 'Kommende Events',
  listLine: (number: number, title: string, startsAt: Date, going: number) =>
    `${code(`#${number}`)}  ${bold(title)}  ${timestamp(startsAt, 'f')}  ${count(going)} dabei`,
  listEmpty: [
    'Noch nichts geplant.',
    'Der Kalender ist leer.',
    'Keine Events in Sicht. Ruhige Woche.',
  ],
  listHint: (prefix: string) => subtext(`${prefix}event create fr 20:00 Filmabend`),
  notFound: (number: number) => ({
    content: `Ein Event ${code(String(number))} gibt es hier nicht.`,
    deleteAfter: 15_000,
  }),
  alreadyOver: (number: number, status: string) => ({
    content: `Event ${number} ist schon ${statusWords[status] ?? status}.`,
    deleteAfter: 15_000,
  }),
  cancelled: (title: string) => `${bold(title)} ist abgesagt.`,
  rewardReason: (title: string) => `Event: ${title}`,

  embed: {
    when: (startsAt: Date) => `**Wann** ${timestamp(startsAt, 'F')} (${timestamp(startsAt, 'R')})`,
    until: (endsAt: Date) => `**Bis** ${timestamp(endsAt, 't')}`,
    repeats: (recurrence: string, weekday: string, day: number) =>
      recurrence === 'daily'
        ? '**Wiederholt sich** jeden Tag'
        : recurrence === 'weekly'
          ? `**Wiederholt sich** jeden ${weekdayLabels[weekday] ?? weekday}`
          : `**Wiederholt sich** jeden Monat am ${day}.`,
    whereChannel: (channelId: string) => `**Wo** ${mention.channel(channelId)}`,
    where: (location: string) => `**Wo** ${location}`,
    counts: (going: number, maybe: number, no: number) =>
      `**${count(going)}** dabei, **${count(maybe)}** vielleicht, **${count(no)}** können nicht`,
    more: (left: number) => `und ${count(left)} weitere`,
    hint: (going: string, maybe: string, no: string) =>
      subtext(
        `Reagier mit ${going}, wenn du dabei bist, mit ${maybe} für vielleicht und mit ${no}, wenn du nicht kannst.`,
      ),
    reward: (amount: number, unit: string) =>
      `**Belohnung** ${count(amount)} ${unit} für alle, die dabei sind`,
    cancelled: '**Abgesagt.**',
    ended: 'Das ist vorbei.',
    footer: (number: number) => `Event ${number}`,
  },

  reminder: (title: string, startsAt: Date, where: string | null, guildName: string | null) =>
    lines(
      `${bold(title)} beginnt ${timestamp(startsAt, 'R')}.`,
      where,
      subtext(guildName ? `${escapeMarkdown(guildName)}. Du hast zugesagt.` : 'Du hast zugesagt.'),
    ),

  poll: {
    problems: {
      question: 'Dafür brauche ich eine Frage.',
      few: 'Eine Umfrage braucht mindestens zwei Optionen.',
      many: 'Höchstens zehn Optionen. Es gibt nur zehn Zahlen-Reaktionen.',
      long: 'Die Frage darf höchstens 250 Zeichen haben, jede Option höchstens 100.',
      duplicate: 'Zwei Optionen sind gleich.',
    },
    yes: 'Ja',
    no: 'Nein',
    single: 'Wähl eine.',
    multiple: 'Wähl so viele, wie du willst.',
    anonymous: 'Die Abstimmung ist anonym. Deine Reaktion verschwindet, deine Stimme bleibt.',
    toggle: 'Reagier noch mal mit derselben Zahl, um sie zurückzunehmen.',
    ends: (endsAt: Date) => `Endet ${timestamp(endsAt, 'R')}.`,
    votersOpen: (voters: number) =>
      voters === 0
        ? 'Noch keine Stimmen.'
        : `Bisher ${voters === 1 ? 'hat' : 'haben'} **${plural(voters, 'Person', 'Personen')}** abgestimmt.`,
    votersClosed: (voters: number) =>
      voters === 0
        ? 'Niemand hat abgestimmt.'
        : `**${plural(voters, 'Person', 'Personen')}** ${voters === 1 ? 'hat' : 'haben'} abgestimmt.`,
    closed: '**Beendet.**',
    cancelled: '**Abgebrochen.**',
    footer: (number: number) => `Umfrage ${number}`,
    winner: (question: string, winners: string[], votes: number, total: number) =>
      winners.length === 0
        ? `Umfrage beendet. Bei ${bold(question)} hat niemand abgestimmt.`
        : winners.length === 1
          ? `Umfrage beendet. ${bold(winners[0] ?? '')} gewinnt mit ${count(votes)} von ${plural(total, 'Stimme', 'Stimmen')}.`
          : `Umfrage beendet. Gleichstand zwischen ${andList(winners.map((winner) => bold(winner)))} mit je ${plural(votes, 'Stimme', 'Stimmen')}.`,
    receiptAdded: (question: string, option: string) =>
      lines(
        `Deine Stimme bei ${bold(question)}: ${bold(option)}.`,
        subtext('Reagier noch mal mit derselben Zahl, um sie zurückzunehmen.'),
      ),
    receiptMoved: (question: string, option: string) =>
      `Deine Stimme bei ${bold(question)} steht jetzt auf ${bold(option)}.`,
    receiptRemoved: (question: string, option: string) =>
      `Deine Stimme für ${bold(option)} bei ${bold(question)} ist zurückgenommen.`,
    cardTitle: 'Endergebnis',
    cardVoters: (voters: number, multiple: boolean) =>
      `${plural(voters, 'Person', 'Personen')} ${voters === 1 ? 'hat' : 'haben'} abgestimmt${multiple ? ', mehrere Antworten erlaubt' : ''}`,
    tooLong: 'Eine Umfrage läuft höchstens 30 Tage.',
    noChannel: 'Hier kann ich die Umfrage nicht posten.',
  },
};

export default de;
