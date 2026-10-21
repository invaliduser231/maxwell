import { copy } from './copy.js';

export interface RiskInput {
  accountCreated: Date;
  joinedAt: Date | null;
  nameChanges: number;
  activeWarns: number;
  bans: number;
  now?: number;
}

const DAY = 86_400_000;
export const NEW_ACCOUNT_MS = 7 * DAY;
export const RECENT_JOIN_MS = DAY;
export const NAME_CHANGE_THRESHOLD = 3;

export function riskHints(input: RiskInput): string[] {
  const now = input.now ?? Date.now();
  const hints: string[] = [];
  const age = now - input.accountCreated.getTime();
  if (age < NEW_ACCOUNT_MS) hints.push(copy.risk.newAccount(age));
  if (input.joinedAt && now - input.joinedAt.getTime() < RECENT_JOIN_MS)
    hints.push(copy.risk.recentJoin);
  if (input.nameChanges >= NAME_CHANGE_THRESHOLD) hints.push(copy.risk.names(input.nameChanges));
  if (input.activeWarns > 0) hints.push(copy.risk.warns(input.activeWarns));
  if (input.bans > 0) hints.push(copy.risk.banned(input.bans));
  return hints;
}
