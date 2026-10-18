import type { RsvpStatus } from '@maxwell/core/stores/events';

export const numberEmojis: readonly string[] = [
  '1️⃣',
  '2️⃣',
  '3️⃣',
  '4️⃣',
  '5️⃣',
  '6️⃣',
  '7️⃣',
  '8️⃣',
  '9️⃣',
  '\u{1F51F}',
];

export function normalizeEmoji(value: string): string {
  const custom = /^<a?:(\w+):(\d+)>$/.exec(value.trim());
  if (custom) return `${custom[1]}:${custom[2]}`;
  return value.trim().replaceAll('️', '');
}

export function displayEmoji(value: string): string {
  const normalized = normalizeEmoji(value);
  return /^\w+:\d+$/.test(normalized) ? `<:${normalized}>` : value.trim();
}

export function reactionEmoji(value: string): string {
  const custom = /^<a?:(\w+):(\d+)>$/.exec(value.trim());
  return custom ? `${custom[1]}:${custom[2]}` : value.trim();
}

export function optionIndex(emoji: string): number {
  const normalized = normalizeEmoji(emoji);
  return numberEmojis.findIndex((candidate) => normalizeEmoji(candidate) === normalized);
}

export interface RsvpEmojis {
  going: string;
  maybe: string;
  no: string;
}

export function rsvpStatusFor(emoji: string, emojis: RsvpEmojis): RsvpStatus | null {
  const normalized = normalizeEmoji(emoji);
  for (const status of ['going', 'maybe', 'no'] as const) {
    if (normalizeEmoji(emojis[status]) === normalized) return status;
  }
  return null;
}
