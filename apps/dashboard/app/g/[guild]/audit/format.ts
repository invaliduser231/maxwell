import type { Key, Translator } from '@/lib/i18n';

const MOD_ACTION = /^(case\.|automod\.gate\.|automod\.lockdown)/;

export type EntryKind = 'settings' | 'mod' | 'auto';

export function kindOf(actorId: string | null, action: string): EntryKind {
  if (actorId === null) return 'auto';
  return MOD_ACTION.test(action) ? 'mod' : 'settings';
}

export const kindInfo: Record<EntryKind, { name: Key }> = {
  settings: { name: 'Setting' },
  mod: { name: 'Mod action' },
  auto: { name: 'Automatic' },
};

const IRREGULAR = new Set([
  'Took',
  'Gave',
  'Sent',
  'Made',
  'Set',
  'Put',
  'Let',
  'Ran',
  'Held',
  'Undid',
  'Won',
  'Began',
  'Built',
]);

function isVerb(word: string): boolean {
  if (IRREGULAR.has(word)) return true;
  return /^[A-Z][a-z]{2,}ed$/.test(word) && !word.endsWith('eed');
}

export function sentence(
  t: Translator,
  name: string | null,
  summary: string,
): { text: string; byline: boolean } {
  if (!name) return { text: summary, byline: false };
  if (t.lang !== 'en') return { text: summary, byline: true };
  const first = summary.split(' ', 1)[0] ?? '';
  if (isVerb(first)) {
    return { text: `${name} ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`, byline: false };
  }
  return { text: summary, byline: true };
}

export interface AuditQuery {
  module: string | null;
  actor: string | null;
  range: 'any' | '1' | '7' | '30' | '90';
  kind: 'all' | EntryKind;
  search: string;
}

export const PAGE_SIZE = 30;

export const ranges: { value: AuditQuery['range']; label: Key }[] = [
  { value: 'any', label: 'Any time' },
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

export const MAXWELL = 'maxwell';
