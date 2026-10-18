import type { RsvpStatus } from '@maxwell/core/stores/events';
import type { Platform } from '../../platform/types.js';

const PAGE = 100;
export const MAX_PAGES = 50;

export interface Reactors {
  users: string[];
  complete: boolean;
}

export async function allReactors(
  platform: Pick<Platform, 'reactionUsers'>,
  channelId: string,
  messageId: string,
  emoji: string,
  maxPages = MAX_PAGES,
): Promise<Reactors> {
  const users: string[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const batch = await platform.reactionUsers(channelId, messageId, emoji, PAGE, after);
    users.push(...batch);
    if (batch.length < PAGE) return { users, complete: true };
    const last = batch.at(-1);
    if (!last || last === after) return { users, complete: true };
    after = last;
  }
  return { users, complete: false };
}

export async function dropBots(
  platform: Pick<Platform, 'user' | 'selfId'>,
  reacted: Map<string, unknown>,
  known: ReadonlyMap<string, unknown>,
): Promise<void> {
  if (platform.selfId) reacted.delete(platform.selfId);
  for (const userId of [...reacted.keys()]) {
    if (known.has(userId)) continue;
    const user = await platform.user(userId).catch(() => null);
    if (user?.bot) reacted.delete(userId);
  }
}

export interface VotePlan {
  set: Map<string, number[]>;
  unreact: { userId: string; option: number }[];
}

function sameSet(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((value) => seen.has(value));
}

export function planVotes(
  stored: ReadonlyMap<string, readonly number[]>,
  reacted: ReadonlyMap<string, readonly number[]>,
  multiple: boolean,
  complete: boolean,
): VotePlan {
  const plan: VotePlan = { set: new Map(), unreact: [] };
  const users = new Set([...stored.keys(), ...reacted.keys()]);
  for (const userId of users) {
    const had = [...(stored.get(userId) ?? [])].sort((a, b) => a - b);
    const has = [...new Set(reacted.get(userId) ?? [])].sort((a, b) => a - b);
    let target: number[];
    if (has.length === 0) {
      target = complete ? [] : had;
    } else if (multiple) {
      target = complete ? has : [...new Set([...had, ...has])].sort((a, b) => a - b);
    } else {
      const kept = had.find((option) => has.includes(option));
      target = [kept ?? (has[0] as number)];
      for (const option of has) {
        if (option !== target[0]) plan.unreact.push({ userId, option });
      }
    }
    if (!sameSet(had, target)) plan.set.set(userId, target);
  }
  return plan;
}

export interface RsvpPlan {
  set: { userId: string; status: RsvpStatus }[];
  clear: { userId: string; status: RsvpStatus }[];
  unreact: { userId: string; status: RsvpStatus }[];
}

const order: readonly RsvpStatus[] = ['going', 'maybe', 'no'];

export function planRsvps(
  stored: ReadonlyMap<string, RsvpStatus>,
  reacted: ReadonlyMap<string, readonly RsvpStatus[]>,
  complete: boolean,
): RsvpPlan {
  const plan: RsvpPlan = { set: [], clear: [], unreact: [] };
  const users = new Set([...stored.keys(), ...reacted.keys()]);
  for (const userId of users) {
    const had = stored.get(userId) ?? null;
    const picked = reacted.get(userId) ?? [];
    const has = order.filter((status) => picked.includes(status));
    if (has.length === 0) {
      if (had && complete) plan.clear.push({ userId, status: had });
      continue;
    }
    const target = had && has.includes(had) ? had : (has[0] as RsvpStatus);
    if (target !== had) plan.set.push({ userId, status: target });
    for (const status of has) {
      if (status !== target) plan.unreact.push({ userId, status });
    }
  }
  return plan;
}
