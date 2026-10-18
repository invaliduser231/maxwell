import { mention } from '../../commands/mentions.js';
import { localized } from '../../i18n/localized.js';
import { bold, count, plural, timestamp } from '../../ui/format.js';
import { andList } from '../../ui/voice.js';
import de from './copy.de.js';
import type { Unmet } from './draw.js';

export const fallbackEmoji = '🎉';

export const audit = {
  start: (prize: string) => `Started a giveaway for ${prize}`,
  end: (prize: string) => `Ended the giveaway for ${prize} early`,
  reroll: (prize: string, n: number) =>
    `Rerolled ${n} ${n === 1 ? 'winner' : 'winners'} for ${prize}`,
  cancel: (prize: string) => `Cancelled the giveaway for ${prize}`,
};

const en = {
  giveawayDescription: 'Starts, ends and rerolls giveaways.',
  startDescription: 'Starts a giveaway here or in another channel.',
  endDescription: 'Ends a giveaway now and draws the winners.',
  rerollDescription: 'Draws new winners for an ended giveaway.',
  listDescription: 'Running and planned giveaways.',

  enter: (emoji: string) => `React with ${emoji} to enter.`,
  ends: (at: Date) => `**Ends** ${timestamp(at, 'R')} (${timestamp(at, 'f')})`,
  ended: (at: Date) => `**Ended** ${timestamp(at, 'R')}`,
  winnersCount: (n: number) => `**Winners** ${count(n)}`,
  winnersList: (ids: readonly string[]) => `**Winners** ${ids.map(mention.user).join(', ')}`,
  rerolled: (ids: readonly string[]) => `**Rerolled** ${ids.map(mention.user).join(', ')}`,
  noWinners: 'No valid entries, so nobody won.',
  host: (id: string) => `**Hosted by** ${mention.user(id)}`,
  entries: (n: number) => `**Entries** ${count(n)}`,
  needs: (parts: readonly string[]) => `**Needs** ${parts.join(', ')}`,
  needRole: (roleId: string) => mention.role(roleId),
  needLevel: (level: number) => `level ${count(level)}`,
  needDays: (days: number) => `${plural(days, 'day')} in the community`,
  notFor: (roleId: string) => `**Not for** ${mention.role(roleId)}`,
  bonus: (parts: readonly { roleId: string; entries: number }[]) =>
    `**Bonus entries** ${parts.map((part) => `${mention.role(part.roleId)} +${part.entries}`).join(', ')}`,
  footer: (number: number) => `Giveaway ${number}`,

  won: (ids: readonly string[], prize: string) =>
    `${andList(ids.map(mention.user))} won ${bold(prize)}.`,
  nobodyWon: (prize: string) =>
    `Nobody entered the giveaway for ${bold(prize)}, so there is no winner.`,
  newWinners: (ids: readonly string[], prize: string) =>
    `New ${ids.length === 1 ? 'winner' : 'winners'} for ${bold(prize)}: ${andList(ids.map(mention.user))}.`,
  nobodyLeft: (prize: string) => `Nobody left to draw for ${bold(prize)}.`,
  wonDirect: (prize: string, server: string) => `You won ${bold(prize)} in ${bold(server)}.`,
  theCommunity: 'the community',
  inChannel: (channelId: string) => `in ${mention.channel(channelId)}`,

  unmet: (
    reason: Unmet,
    prize: string,
    detail: { role: string | null; level: number; days: number },
  ) => {
    const lead = `You can't enter the giveaway for ${bold(prize)} yet.`;
    switch (reason) {
      case 'excluded':
        return detail.role
          ? `${lead} Members with the ${bold(detail.role)} role can't take part.`
          : `${lead} One of your roles can't take part.`;
      case 'role':
        return detail.role
          ? `${lead} It needs the ${bold(detail.role)} role.`
          : `${lead} It needs a role you don't have.`;
      case 'level':
        return `${lead} It needs level ${count(detail.level)}.`;
      case 'age':
        return `${lead} It needs ${plural(detail.days, 'day')} in the community.`;
    }
  },

  started: (number: number, channelId: string) =>
    `Giveaway ${number} is running in ${mention.channel(channelId)}.`,
  endedNow: (number: number) => `Giveaway ${number} ended.`,
  rerolledNow: (number: number) => `New winners for giveaway ${number} are posted.`,
  tooShort: 'Giveaways run for at least a minute.',
  tooLong: 'Giveaways can run for 60 days at most.',
  prizeTooLong: 'Keep the prize under 256 characters.',
  badOption: (flag: string) =>
    `I don't understand \`--${flag}\`. Options are \`--role\`, \`--not\` and \`--ping\` with a role, \`--level\` and \`--days\` with a number, and \`--nodm\`.`,
  notFound: (number: number) => `There is no giveaway ${number} here.`,
  noneRunning: 'No giveaway is running.',
  noneEnded: 'No giveaway has ended yet.',
  notRunning: (number: number) => `Giveaway ${number} isn't running.`,
  notEnded: (number: number) => `Giveaway ${number} hasn't ended yet.`,
  channelGone: "That's not a channel I can see.",
  listTitle: 'Giveaways',
  listRunning: (number: number, prize: string, channelId: string, endsAt: Date, winners: number) =>
    `\`${number}\` ${bold(prize)} in ${mention.channel(channelId)}, ends ${timestamp(endsAt, 'R')}, ${plural(winners, 'winner')}`,
  listScheduled: (number: number, prize: string, channelId: string, startsAt: Date) =>
    `\`${number}\` ${bold(prize)} in ${mention.channel(channelId)}, starts ${timestamp(startsAt, 'R')}`,
  emptyList: ['No giveaways running. Generosity is on a break.', 'Nothing running right now.'],
};

export type GiveawaysCopy = typeof en;

export const copy = localized(en, { de });
