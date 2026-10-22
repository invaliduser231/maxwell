import type { IconName, IconSet } from '../../ui/icons.js';

export const fallbackEmoji = {
  open: '\u{1F4E9}',
  close: '\u{1F512}',
  accept: '\u{2705}',
  decline: '\u{274C}',
  sent: '\u{2705}',
} as const;

export const ratingEmojis = [1, 2, 3, 4, 5].map((n) => `${n}\u{FE0F}\u{20E3}`);

const customTag = /^<a?:([\w~-]+):(\d+)>$/;
const customPair = /^:?([\w~-]+):(\d+):?$/;

export function normalizeEmoji(input: string): string {
  const trimmed = input.trim();
  const tag = customTag.exec(trimmed);
  if (tag) return `${tag[1]}:${tag[2]}`;
  const pair = customPair.exec(trimmed);
  if (pair) return `${pair[1]}:${pair[2]}`;
  return trimmed;
}

function key(emoji: string): string {
  const normalized = normalizeEmoji(emoji);
  const custom = /:(\d+)$/.exec(normalized);
  if (custom?.[1]) return `id:${custom[1]}`;
  return normalized.replaceAll('\u{FE0F}', '');
}

export function sameEmoji(a: string, b: string): boolean {
  return key(a) === key(b);
}

export function displayEmoji(reaction: string): string {
  const normalized = normalizeEmoji(reaction);
  const custom = /^([\w~-]+):(\d+)$/.exec(normalized);
  return custom ? `<:${custom[1]}:${custom[2]}>` : normalized;
}

export function ratingFromEmoji(emoji: string): number | null {
  const index = ratingEmojis.findIndex((candidate) => sameEmoji(candidate, emoji));
  return index === -1 ? null : index + 1;
}

export function ratingFromText(text: string): number | null {
  const match = /^\s*([1-5])\s*(?:\/\s*5|of 5)?\s*\.?\s*$/i.exec(text);
  return match?.[1] ? Number(match[1]) : null;
}

export function iconReaction(icons: IconSet, name: IconName, fallback: string): string {
  return icons.reaction(name) ?? fallback;
}
