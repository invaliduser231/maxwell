import { mention } from '../../commands/mentions.js';
import { localized } from '../../i18n/localized.js';
import { code, count, plural } from '../../ui/format.js';
import de from './copy.de.js';

const en = {
  rankDescription: "Your level and rank, or someone else's.",
  levelsDescription: 'The leaderboard.',
  xpDescription: 'Adjusts XP by hand.',
  giveDescription: 'Gives a member XP.',
  takeDescription: 'Takes XP from a member.',
  resetDescription: 'Sets a member back to zero.',

  noXpSelf: ['No XP yet. Say something first.', 'Nothing on the board for you yet.'],
  noXpOther: (userId: string) => `${mention.user(userId)} has no XP yet.`,
  emptyBoard: [
    'The leaderboard is empty. Someone has to say something first.',
    'Nobody has any XP yet. Quiet in here.',
  ],
  pageTooFar: (pages: number) =>
    `There ${pages === 1 ? 'is' : 'are'} only ${plural(pages, 'page')}.`,
  boardTitle: 'Leaderboard',
  community: 'This community',
  boardSubtitle: (community: string, page: number, pages: number) =>
    pages > 1 ? `${community}, page ${page} of ${pages}` : community,
  boardYou: (rank: number, level: number) => `You: #${count(rank)}, level ${count(level)}`,
  boardNotYou: "You're not on the board yet",
  boardNext: (prefix: string, page: number) => `Next page: ${code(`${prefix}levels ${page}`)}`,
  levelValue: (level: number) => `Level ${count(level)}`,
  xpValue: (xp: number) => `${count(xp)} XP`,
  rankLine: (level: number, into: number, needed: number) =>
    `**Level ${count(level)}**  ${count(into)} / ${count(needed)} XP to ${count(level + 1)}`,
  rankPlace: (rank: number, total: number) => `**Rank** #${count(rank)} of ${count(total)}`,
  totalXp: (xp: number) => `**Total** ${count(xp)} XP`,

  gave: (amount: number, userId: string, level: number) =>
    `${mention.user(userId)} got ${count(amount)} XP and is level ${count(level)}.`,
  took: (amount: number, userId: string, level: number) =>
    `Took ${count(amount)} XP from ${mention.user(userId)}. Level ${count(level)} now.`,
  reset: (userId: string) => `${mention.user(userId)} is back at zero.`,
  nothingToReset: (userId: string) => `${mention.user(userId)} has no XP to reset.`,
  botTarget: "Bots don't collect XP.",

  rewardReason: (level: number) => `Level ${level} reward`,
  levelUp: '**{name}** is now level {level}.',
  levelUpReward: '**{name}** is now level {level} and gets **{role}**.',
};

export type LevelsCopy = typeof en;

export const copy = localized(en, { de });

export function levelUpTemplate(template: string, reward: boolean): string {
  if (reward) return template === en.levelUpReward ? copy.levelUpReward : template;
  return template === en.levelUp ? copy.levelUp : template;
}

export const audit = {
  give: (amount: number, name: string) => `Gave ${amount} XP to ${name}`,
  take: (amount: number, name: string) => `Took ${amount} XP from ${name}`,
  reset: (name: string) => `Reset the XP of ${name}`,
  import: (rows: number) => `Imported XP for ${rows} ${rows === 1 ? 'member' : 'members'}`,
  resetAll: (rows: number) => `Reset XP for ${rows} ${rows === 1 ? 'member' : 'members'}`,
};

export const milestones = new Set([10, 25, 50, 100, 250, 500, 1000]);
