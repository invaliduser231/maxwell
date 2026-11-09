import { mention } from '../../commands/mentions.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/events.json' with { type: 'json' };
import { bold, code, escapeMarkdown, lines, subtext, timestamp } from '../../ui/format.js';
import { andList } from '../../ui/voice.js';

export const audit = {
  create: (title: string) => `Created event "${title}"`,
  cancel: (title: string) => `Cancelled event "${title}"`,
  poll: (question: string) => `Started poll "${question}"`,
};

export const copy = catalog('events', en, (m) => ({
  created: (title: string, startsAt: Date, channelId: string) =>
    m.created({
      title: escapeMarkdown(title),
      when: timestamp(startsAt, 'F'),
      channel: mention.channel(channelId),
    }),
  createdHint: (prefix: string, number: number) =>
    subtext(
      m.createdHint({ number: String(number), command: code(`${prefix}event cancel ${number}`) }),
    ),
  listLine: (number: number, title: string, startsAt: Date, going: number) =>
    m.listLine({
      number: code(`#${number}`),
      title: escapeMarkdown(title),
      when: timestamp(startsAt, 'f'),
      going,
    }),
  listHint: (prefix: string) => subtext(m.listHint({ prefix })),
  notFound: (number: number) => ({
    content: m.notFound({ number: code(String(number)) }),
    deleteAfter: 15_000,
  }),
  alreadyOver: (number: number, status: string) => ({
    content: m.alreadyOver({ number: String(number), status }),
    deleteAfter: 15_000,
  }),
  cancelled: (title: string) => m.cancelled({ title: escapeMarkdown(title) }),
  rewardReason: (title: string) => m.rewardReason({ title }),
  embed: {
    when: (startsAt: Date) =>
      m.embed.when({ date: timestamp(startsAt, 'F'), relative: timestamp(startsAt, 'R') }),
    until: (endsAt: Date) => m.embed.until({ time: timestamp(endsAt, 't') }),
    repeats: (recurrence: string, weekday: string, day: number) =>
      m.embed.repeats({ recurrence, weekday, day }),
    whereChannel: (channelId: string) =>
      m.embed.whereChannel({ channel: mention.channel(channelId) }),
    where: (location: string) => m.embed.where({ location }),
    counts: (going: number, maybe: number, no: number) => m.embed.counts({ going, maybe, no }),
    more: (left: number) => m.embed.more({ left }),
    hint: (going: string, maybe: string, no: string) => subtext(m.embed.hint({ going, maybe, no })),
    reward: (amount: number, unit: string) => m.embed.reward({ amount, unit }),
    footer: (number: number) => m.embed.footer({ number: String(number) }),
  },
  reminder: (title: string, startsAt: Date, where: string | null, guildName: string | null) =>
    lines(
      m.reminder({ title: escapeMarkdown(title), when: timestamp(startsAt, 'R') }),
      where,
      subtext(
        m.reminderNote({
          place: guildName ? 'guild' : 'none',
          guild: escapeMarkdown(guildName ?? ''),
        }),
      ),
    ),
  poll: {
    ends: (endsAt: Date) => m.poll.ends({ when: timestamp(endsAt, 'R') }),
    votersOpen: (voters: number) => m.poll.votersOpen({ voters }),
    votersClosed: (voters: number) => m.poll.votersClosed({ voters }),
    footer: (number: number) => m.poll.footer({ number: String(number) }),
    winner: (question: string, winners: string[], votes: number, total: number) =>
      m.poll.winner({
        result: winners.length === 0 ? 'none' : winners.length === 1 ? 'one' : 'tie',
        question: escapeMarkdown(question),
        winner: escapeMarkdown(winners[0] ?? ''),
        winners: andList(winners.map((winner) => bold(winner))),
        votes,
        total,
      }),
    receiptAdded: (question: string, option: string) =>
      lines(
        m.poll.receiptAdded({ question: escapeMarkdown(question), option: escapeMarkdown(option) }),
        subtext(m.poll.toggle()),
      ),
    receiptMoved: (question: string, option: string) =>
      m.poll.receiptMoved({ question: escapeMarkdown(question), option: escapeMarkdown(option) }),
    receiptRemoved: (question: string, option: string) =>
      m.poll.receiptRemoved({ question: escapeMarkdown(question), option: escapeMarkdown(option) }),
    cardVoters: (voters: number, multiple: boolean) =>
      m.poll.cardVoters({ voters, multiple: multiple ? 'yes' : 'no' }),
  },
}));
