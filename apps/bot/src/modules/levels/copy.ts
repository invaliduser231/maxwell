import { mention } from '../../commands/mentions.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/levels.json' with { type: 'json' };

export const copy = catalog('levels', en, (m) => ({
  noXpOther: (userId: string) => m.noXpOther({ user: mention.user(userId) }),
  pageTooFar: (pages: number) => m.pageTooFar({ pages }),
  boardSubtitle: (community: string, page: number, pages: number) =>
    pages > 1 ? m.boardSubtitle({ community, page, pages }) : community,
  boardYou: (rank: number, level: number) => m.boardYou({ rank, level }),
  boardNext: (prefix: string, page: number) => m.boardNext({ prefix, page }),
  levelValue: (level: number) => m.levelValue({ level }),
  xpValue: (xp: number) => m.xpValue({ xp }),
  rankLine: (level: number, into: number, needed: number) =>
    m.rankLine({ level, into, needed, next: level + 1 }),
  rankPlace: (rank: number, total: number) => m.rankPlace({ rank, total }),
  totalXp: (xp: number) => m.totalXp({ xp }),
  gave: (amount: number, userId: string, level: number) =>
    m.gave({ amount, user: mention.user(userId), level }),
  took: (amount: number, userId: string, level: number) =>
    m.took({ amount, user: mention.user(userId), level }),
  reset: (userId: string) => m.reset({ user: mention.user(userId) }),
  nothingToReset: (userId: string) => m.nothingToReset({ user: mention.user(userId) }),
  rewardReason: (level: number) => m.rewardReason({ level: String(level) }),
}));

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
