import type { CaseAction } from '@maxwell/core/modules/moderation';

export const PAGE_SIZE = 25;

export type Range = 'day' | 'week' | 'month' | 'all';

export interface CaseQuery {
  action: CaseAction | null;
  mod: string | null;
  range: Range;
  q: string;
  page: number;
}

export interface Stats {
  activeTimeouts: number;
  timeoutEndsAt: string | null;
  activeBans: number;
  temporaryBans: number;
  warns30: number;
  warned30: number;
  total30: number;
  automated30: number;
}
