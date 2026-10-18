import { randomInt } from 'node:crypto';
import type { BonusEntry } from '@maxwell/core/modules/giveaways';

export interface Candidate {
  userId: string;
  weight: number;
}

export interface Requirements {
  requiredRoleId: string | null;
  excludedRoleId?: string | null;
  minLevel: number;
  minMemberDays: number;
}

export interface Applicant {
  roles: readonly string[];
  joinedAt: Date | null;
}

export type Unmet = 'excluded' | 'role' | 'level' | 'age';

export const MAX_WEIGHT = 100;

const DAY = 24 * 60 * 60 * 1000;

export const unitRandom = (): number => randomInt(1, 2 ** 48) / 2 ** 48;

export function entryWeight(bonus: readonly BonusEntry[], roles: readonly string[]): number {
  const extra = bonus
    .filter((entry) => roles.includes(entry.roleId))
    .reduce((sum, entry) => sum + entry.entries, 0);
  return Math.min(1 + extra, MAX_WEIGHT);
}

export function unmet(
  requirements: Requirements,
  applicant: Applicant,
  level: number | null,
  now = Date.now(),
): Unmet | null {
  if (requirements.excludedRoleId && applicant.roles.includes(requirements.excludedRoleId)) {
    return 'excluded';
  }
  if (requirements.requiredRoleId && !applicant.roles.includes(requirements.requiredRoleId)) {
    return 'role';
  }
  if (requirements.minLevel > 0 && (level ?? 0) < requirements.minLevel) return 'level';
  if (requirements.minMemberDays > 0) {
    const joined = applicant.joinedAt?.getTime();
    if (joined === undefined || now - joined < requirements.minMemberDays * DAY) return 'age';
  }
  return null;
}

export function weightedOrder(
  candidates: readonly Candidate[],
  random: () => number = unitRandom,
): string[] {
  return candidates
    .filter((candidate) => candidate.weight > 0)
    .map((candidate) => ({
      userId: candidate.userId,
      key: Math.log(Math.max(random(), Number.MIN_VALUE)) / candidate.weight,
    }))
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.userId);
}

export async function pickWinners(
  candidates: readonly Candidate[],
  count: number,
  exclude: ReadonlySet<string>,
  accept: (userId: string) => Promise<boolean>,
  random: () => number = unitRandom,
): Promise<string[]> {
  const winners: string[] = [];
  for (const userId of weightedOrder(candidates, random)) {
    if (winners.length >= count) break;
    if (exclude.has(userId)) continue;
    if (await accept(userId)) winners.push(userId);
  }
  return winners;
}

export function reactionForm(emoji: string): string {
  return emoji.trim().replace(/^<a?:/, '').replace(/>$/, '');
}

export function sameEmoji(a: string, b: string): boolean {
  return reactionForm(a).replaceAll('️', '') === reactionForm(b).replaceAll('️', '');
}

export function displayEmoji(emoji: string): string {
  return /^[\w~-]+:\d+$/.test(emoji) ? `<:${emoji}>` : emoji;
}

export const REACTION_PAGE = 100;
export const MAX_REACTION_PAGES = 500;

export async function collectReactors(
  fetch: (after: string | undefined) => Promise<string[]>,
  pageSize = REACTION_PAGE,
  maxPages = MAX_REACTION_PAGES,
): Promise<{ users: string[]; complete: boolean }> {
  const users: string[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    let batch: string[];
    try {
      batch = await fetch(after);
    } catch {
      return { users, complete: false };
    }
    users.push(...batch);
    const last = batch.at(-1);
    if (batch.length < pageSize || last === undefined) return { users, complete: true };
    if (last === after) return { users, complete: false };
    after = last;
  }
  return { users, complete: false };
}

export interface EntryWallet {
  giveawayEntries(guildId: string, userId: string, giveawayId: string | null): Promise<number>;
  takeItem(guildId: string, userId: string, kind: string, ref: string | null): Promise<boolean>;
}

const SHOP_BATCH = 25;

export async function claimShopEntries(
  wallet: EntryWallet,
  guildId: string,
  giveawayId: string,
  entries: readonly Candidate[],
): Promise<Map<string, number>> {
  const weights = new Map<string, number>();
  for (let i = 0; i < entries.length; i += SHOP_BATCH) {
    await Promise.all(
      entries.slice(i, i + SHOP_BATCH).map(async (entry) => {
        const room = MAX_WEIGHT - entry.weight;
        if (room <= 0) return;
        const held = await wallet.giveawayEntries(guildId, entry.userId, giveawayId);
        if (held <= 0) return;
        let taken = 0;
        for (const ref of [giveawayId, null]) {
          while (taken < Math.min(held, room)) {
            if (!(await wallet.takeItem(guildId, entry.userId, 'giveaway', ref))) break;
            taken++;
          }
        }
        if (taken > 0) weights.set(entry.userId, entry.weight + taken);
      }),
    );
  }
  return weights;
}
