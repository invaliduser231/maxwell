import type { EventRow, PollResults, PollRow, RsvpCounts } from '@maxwell/core/stores/events';
import { toLocal, weekdayOf } from '@maxwell/core/stores/scheduler';
import { mention } from '../../commands/mentions.js';
import type { Embed } from '../../platform/types.js';
import { count, escapeMarkdown, lines, subtext, truncate } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { copy } from './copy.js';
import { displayEmoji, numberEmojis, type RsvpEmojis } from './emoji.js';

const GOING_SHOWN = 30;

export function eventEnd(
  event: Pick<EventRow, 'startsAt' | 'durationMinutes'>,
  fallback: number,
): Date {
  return new Date(event.startsAt.getTime() + (event.durationMinutes ?? fallback) * 60_000);
}

export function eventWhere(event: Pick<EventRow, 'voiceChannelId' | 'location'>): string | null {
  if (event.voiceChannelId) return copy.embed.whereChannel(event.voiceChannelId);
  if (event.location) return copy.embed.where(escapeMarkdown(truncate(event.location, 200)));
  return null;
}

export interface EventReward {
  amount: number;
  unit: string;
}

export function eventEmbed(
  event: EventRow,
  counts: RsvpCounts,
  going: readonly string[],
  emojis: RsvpEmojis,
  reward: EventReward | null = null,
): Embed {
  const local = toLocal(event.startsAt.getTime(), event.timezone);
  const live = event.status === 'scheduled';
  const shown = going.slice(0, GOING_SHOWN).map((id) => mention.user(id));
  const hidden = counts.going - shown.length;
  return {
    color: live ? palette.north : palette.muted,
    title: truncate(event.title, 256),
    description: lines(
      event.status === 'cancelled' && copy.embed.cancelled,
      event.status === 'ended' && copy.embed.ended,
      event.status !== 'scheduled' && '',
      event.description ? truncate(event.description, 2_000) : null,
      event.description ? '' : null,
      copy.embed.when(event.startsAt),
      event.durationMinutes ? copy.embed.until(eventEnd(event, 0)) : null,
      event.recurrence !== 'none' &&
        copy.embed.repeats(event.recurrence, weekdayOf(local), local.day),
      eventWhere(event),
      live && reward && copy.embed.reward(reward.amount, reward.unit),
      '',
      copy.embed.counts(counts.going, counts.maybe, counts.no),
      shown.length > 0 && `${shown.join(' ')}${hidden > 0 ? ` ${copy.embed.more(hidden)}` : ''}`,
      live && '',
      live &&
        copy.embed.hint(
          displayEmoji(emojis.going),
          displayEmoji(emojis.maybe),
          displayEmoji(emojis.no),
        ),
    ),
    footer: copy.embed.footer(event.number),
  };
}

export function percentages(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total === 0) return counts.map(() => 0);
  const raw = counts.map((value) => (value / total) * 100);
  const floored = raw.map(Math.floor);
  let left = 100 - floored.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    if ((counts[index] ?? 0) === 0) continue;
    floored[index] = (floored[index] ?? 0) + 1;
    left--;
  }
  return floored;
}

export function winners(counts: readonly number[]): number[] {
  const top = Math.max(0, ...counts);
  if (top === 0) return [];
  return counts.flatMap((value, index) => (value === top ? [index] : []));
}

export function textBar(ratio: number, width = 12): string {
  const filled = Math.round(Math.min(Math.max(ratio, 0), 1) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

export function pollEmbed(poll: PollRow, results: PollResults, pictured = false): Embed {
  const open = poll.status === 'open' || poll.status === 'draft';
  const closed = poll.status === 'closed';
  if (closed && pictured) {
    return {
      color: palette.north,
      title: truncate(poll.question, 256),
      description: lines(copy.poll.closed, copy.poll.votersClosed(results.voters)),
      footer: copy.poll.footer(poll.number),
    };
  }
  const shares = percentages(results.counts);
  const best = new Set(winners(results.counts));
  const top = Math.max(1, ...results.counts);
  const options = poll.options.map((option, index) => {
    const emoji = numberEmojis[index] ?? `${index + 1}.`;
    const label = escapeMarkdown(option);
    if (!closed) return `${emoji} ${label}`;
    const votes = results.counts[index] ?? 0;
    const name = best.has(index) ? `**${label}**` : label;
    return lines(
      `${emoji} ${name}`,
      `${textBar(votes / top)}  ${count(votes)} (${shares[index] ?? 0}%)`,
    );
  });
  const rules = [
    poll.multiple ? copy.poll.multiple : copy.poll.single,
    poll.anonymous ? copy.poll.anonymous : null,
    poll.anonymous ? copy.poll.toggle : null,
    open && poll.endsAt ? copy.poll.ends(poll.endsAt) : null,
  ].filter((part): part is string => part !== null);
  return {
    color: poll.status === 'cancelled' ? palette.muted : palette.north,
    title: truncate(poll.question, 256),
    description: lines(
      closed && copy.poll.closed,
      poll.status === 'cancelled' && copy.poll.cancelled,
      !open && '',
      ...options,
      '',
      closed ? copy.poll.votersClosed(results.voters) : copy.poll.votersOpen(results.voters),
      open && subtext(rules.join(' ')),
    ),
    footer: copy.poll.footer(poll.number),
  };
}

export function winnerLine(poll: PollRow, results: PollResults): string {
  const best = winners(results.counts);
  const names = best.map((index) => poll.options[index] ?? '');
  const votes = best.length ? (results.counts[best[0] ?? 0] ?? 0) : 0;
  return copy.poll.winner(poll.question, names, votes, results.votes);
}

export function receipt(
  outcome: 'added' | 'moved' | 'removed' | 'kept',
  poll: PollRow,
  option: number,
): string | null {
  const label = poll.options[option] ?? '';
  if (outcome === 'added') return copy.poll.receiptAdded(poll.question, label);
  if (outcome === 'moved') return copy.poll.receiptMoved(poll.question, label);
  if (outcome === 'removed') return copy.poll.receiptRemoved(poll.question, label);
  return null;
}
