import { mention } from '../../commands/mentions.js';
import { localized } from '../../i18n/localized.js';
import {
  bold,
  code,
  count,
  escapeMarkdown,
  lines,
  ordinal,
  plural,
  subtext,
  timestamp,
} from '../../ui/format.js';
import { andList } from '../../ui/voice.js';
import de from './copy.de.js';
import type { PollProblem, WhenProblem } from './parse.js';

export const audit = {
  create: (title: string) => `Created event "${title}"`,
  cancel: (title: string) => `Cancelled event "${title}"`,
  poll: (question: string) => `Started poll "${question}"`,
};

const weekdayLabels: Record<string, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

const statusWords: Record<string, string> = {
  cancelled: 'cancelled',
  ended: 'over',
};

const en = {
  commands: {
    event: 'Upcoming events, and planning new ones.',
    create: 'Plans an event with RSVP reactions.',
    list: 'Lists upcoming events.',
    cancel: 'Calls off an event.',
    poll: 'Starts a poll with number reactions.',
  },
  when: {
    missing: 'I need a time and a title for that.',
    invalid: `That's not a time I know. Try ${code('fri 20:00')}, ${code('2026-11-02 19:30')} or ${code('in 3h')}.`,
    past: 'That time has already passed.',
    title: 'The event needs a title.',
    long: 'Keep the title under 200 characters and the description under 2,000.',
  } satisfies Record<WhenProblem | 'title' | 'long', string>,
  created: (title: string, startsAt: Date, channelId: string) =>
    `${bold(title)} is on ${timestamp(startsAt, 'F')}. Posted in ${mention.channel(channelId)}.`,
  createdHint: (prefix: string, number: number) =>
    subtext(`Event ${number}. ${code(`${prefix}event cancel ${number}`)} calls it off.`),
  noChannel: 'There is no event channel set up, and I cannot post here.',
  listTitle: 'Upcoming events',
  listLine: (number: number, title: string, startsAt: Date, going: number) =>
    `${code(`#${number}`)}  ${bold(title)}  ${timestamp(startsAt, 'f')}  ${count(going)} going`,
  listEmpty: ['Nothing planned yet.', 'The calendar is empty.', 'No events coming up. Quiet week.'],
  listHint: (prefix: string) => subtext(`${prefix}event create fri 20:00 Movie night`),
  notFound: (number: number) => ({
    content: `No event ${code(String(number))} here.`,
    deleteAfter: 15_000,
  }),
  alreadyOver: (number: number, status: string) => ({
    content: `Event ${number} is already ${statusWords[status] ?? status}.`,
    deleteAfter: 15_000,
  }),
  cancelled: (title: string) => `${bold(title)} is off.`,
  rewardReason: (title: string) => `Event: ${title}`,

  embed: {
    when: (startsAt: Date) => `**When** ${timestamp(startsAt, 'F')} (${timestamp(startsAt, 'R')})`,
    until: (endsAt: Date) => `**Until** ${timestamp(endsAt, 't')}`,
    repeats: (recurrence: string, weekday: string, day: number) =>
      recurrence === 'daily'
        ? '**Repeats** every day'
        : recurrence === 'weekly'
          ? `**Repeats** every ${weekdayLabels[weekday] ?? weekday}`
          : `**Repeats** every month on the ${ordinal(day)}`,
    whereChannel: (channelId: string) => `**Where** ${mention.channel(channelId)}`,
    where: (location: string) => `**Where** ${location}`,
    counts: (going: number, maybe: number, no: number) =>
      `**${count(going)}** going, **${count(maybe)}** maybe, **${count(no)}** can't make it`,
    more: (left: number) => `and ${count(left)} more`,
    hint: (going: string, maybe: string, no: string) =>
      subtext(
        `React with ${going} if you're going, ${maybe} for maybe, ${no} if you can't make it.`,
      ),
    reward: (amount: number, unit: string) =>
      `**Reward** ${count(amount)} ${unit} for everyone going`,
    cancelled: '**Cancelled.**',
    ended: 'This one is over.',
    footer: (number: number) => `Event ${number}`,
  },

  reminder: (title: string, startsAt: Date, where: string | null, guildName: string | null) =>
    lines(
      `${bold(title)} starts ${timestamp(startsAt, 'R')}.`,
      where,
      subtext(
        guildName
          ? `${escapeMarkdown(guildName)}. You said you're going.`
          : `You said you're going.`,
      ),
    ),

  poll: {
    problems: {
      question: 'I need a question for that.',
      few: 'A poll needs at least two options.',
      many: 'Ten options at most. There are only ten number reactions.',
      long: 'Keep the question under 250 characters and each option under 100.',
      duplicate: 'Two of the options are the same.',
    } satisfies Record<PollProblem, string>,
    yes: 'Yes',
    no: 'No',
    single: 'Pick one.',
    multiple: 'Pick as many as you like.',
    anonymous: 'Votes are anonymous. Your reaction disappears, your vote stays.',
    toggle: 'React with the same number again to take it back.',
    ends: (endsAt: Date) => `Ends ${timestamp(endsAt, 'R')}.`,
    votersOpen: (voters: number) =>
      voters === 0 ? 'No votes yet.' : `**${plural(voters, 'person', 'people')}** voted so far.`,
    votersClosed: (voters: number) =>
      voters === 0 ? 'Nobody voted.' : `**${plural(voters, 'person', 'people')}** voted.`,
    closed: '**Closed.**',
    cancelled: '**Cancelled.**',
    footer: (number: number) => `Poll ${number}`,
    winner: (question: string, winners: string[], votes: number, total: number) =>
      winners.length === 0
        ? `Poll closed. Nobody voted on ${bold(question)}.`
        : winners.length === 1
          ? `Poll closed. ${bold(winners[0] ?? '')} wins with ${count(votes)} of ${plural(total, 'vote')}.`
          : `Poll closed. Tie between ${andList(winners.map((winner) => bold(winner)))} with ${plural(votes, 'vote')} each.`,
    receiptAdded: (question: string, option: string) =>
      lines(
        `Your vote on ${bold(question)}: ${bold(option)}.`,
        subtext('React with the same number again to take it back.'),
      ),
    receiptMoved: (question: string, option: string) =>
      `Changed your vote on ${bold(question)} to ${bold(option)}.`,
    receiptRemoved: (question: string, option: string) =>
      `Took back your vote for ${bold(option)} on ${bold(question)}.`,
    cardTitle: 'Final results',
    cardVoters: (voters: number, multiple: boolean) =>
      `${plural(voters, 'person', 'people')} voted${multiple ? ', several picks allowed' : ''}`,
    tooLong: 'A poll can run for 30 days at most.',
    noChannel: 'I cannot post the poll here.',
  },
};

export type EventsCopy = typeof en;

export const copy = localized(en, { de });
