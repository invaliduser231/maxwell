import { mention } from '../../commands/mentions.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/giveaways.json' with { type: 'json' };
import { bold, escapeMarkdown, timestamp } from '../../ui/format.js';
import { andList } from '../../ui/voice.js';
import type { Unmet } from './draw.js';

export const fallbackEmoji = '🎉';

export const audit = {
  start: (prize: string) => `Started a giveaway for ${prize}`,
  end: (prize: string) => `Ended the giveaway for ${prize} early`,
  reroll: (prize: string, n: number) =>
    `Rerolled ${n} ${n === 1 ? 'winner' : 'winners'} for ${prize}`,
  cancel: (prize: string) => `Cancelled the giveaway for ${prize}`,
};

export const copy = catalog('giveaways', en, (m) => ({
  enter: (emoji: string) => m.enter({ emoji }),
  ends: (at: Date) => m.ends({ relative: timestamp(at, 'R'), full: timestamp(at, 'f') }),
  ended: (at: Date) => m.ended({ at: timestamp(at, 'R') }),
  winnersCount: (n: number) => m.winnersCount({ n }),
  winnersList: (ids: readonly string[]) =>
    m.winnersList({ users: ids.map(mention.user).join(', ') }),
  rerolled: (ids: readonly string[]) => m.rerolled({ users: ids.map(mention.user).join(', ') }),
  host: (id: string) => m.host({ id: mention.user(id) }),
  entries: (n: number) => m.entries({ n }),
  needs: (parts: readonly string[]) => m.needs({ parts: parts.join(', ') }),
  needRole: (roleId: string) => m.needRole({ role: mention.role(roleId) }),
  needLevel: (level: number) => m.needLevel({ level }),
  needDays: (days: number) => m.needDays({ days }),
  notFor: (roleId: string) => m.notFor({ role: mention.role(roleId) }),
  bonus: (parts: readonly { roleId: string; entries: number }[]) =>
    m.bonus({
      parts: parts.map((part) => `${mention.role(part.roleId)} +${part.entries}`).join(', '),
    }),
  footer: (number: number) => m.footer({ number: String(number) }),
  won: (ids: readonly string[], prize: string) =>
    m.won({ count: ids.length, users: andList(ids.map(mention.user)), prize: bold(prize) }),
  nobodyWon: (prize: string) => m.nobodyWon({ prize: escapeMarkdown(prize) }),
  newWinners: (ids: readonly string[], prize: string) =>
    m.newWinners({ count: ids.length, prize: bold(prize), users: andList(ids.map(mention.user)) }),
  nobodyLeft: (prize: string) => m.nobodyLeft({ prize: escapeMarkdown(prize) }),
  wonDirect: (prize: string, server: string) =>
    m.wonDirect({ prize: escapeMarkdown(prize), server: escapeMarkdown(server) }),
  inChannel: (channelId: string) => m.inChannel({ channel: mention.channel(channelId) }),
  unmet: (
    reason: Unmet,
    prize: string,
    detail: { role: string | null; level: number; days: number },
  ) =>
    m.unmet({
      reason,
      hasRole: detail.role ? 'yes' : 'no',
      role: detail.role ? bold(detail.role) : '',
      prize: bold(prize),
      level: detail.level,
      days: detail.days,
    }),
  started: (number: number, channelId: string) =>
    m.started({ number: String(number), channel: mention.channel(channelId) }),
  endedNow: (number: number) => m.endedNow({ number: String(number) }),
  rerolledNow: (number: number) => m.rerolledNow({ number: String(number) }),
  badOption: (flag: string) => m.badOption({ flag }),
  notFound: (number: number) => m.notFound({ number: String(number) }),
  notRunning: (number: number) => m.notRunning({ number: String(number) }),
  notEnded: (number: number) => m.notEnded({ number: String(number) }),
  listRunning: (number: number, prize: string, channelId: string, endsAt: Date, winners: number) =>
    m.listRunning({
      number: String(number),
      prize: bold(prize),
      channel: mention.channel(channelId),
      endsAt: timestamp(endsAt, 'R'),
      winners,
    }),
  listScheduled: (number: number, prize: string, channelId: string, startsAt: Date) =>
    m.listScheduled({
      number: String(number),
      prize: bold(prize),
      channel: mention.channel(channelId),
      startsAt: timestamp(startsAt, 'R'),
    }),
}));
