import type { FeedSource } from '@maxwell/core/modules/feeds';
import { mention } from '../../commands/mentions.js';
import type { Embed, OutgoingMessage } from '../../platform/types.js';
import { timestamp, truncate } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { copy } from './copy.js';
import type { FeedItem } from './parse.js';

export const MAX_POSTS_PER_POLL = 5;
const BACKLOG_GRACE = 24 * 60 * 60 * 1000;

function haystack(item: FeedItem): string {
  return `${item.title}\n${item.summary}\n${item.author ?? ''}`.toLowerCase();
}

export function passesFilters(
  item: FeedItem,
  include: readonly string[],
  exclude: readonly string[],
): boolean {
  const text = haystack(item);
  const wanted = include.map((word) => word.trim().toLowerCase()).filter(Boolean);
  const unwanted = exclude.map((word) => word.trim().toLowerCase()).filter(Boolean);
  if (unwanted.some((word) => text.includes(word))) return false;
  return wanted.length === 0 || wanted.some((word) => text.includes(word));
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z]+)\}/g, (whole, name: string) => values[name] ?? whole);
}

export function itemValues(item: FeedItem, label: string): Record<string, string> {
  return {
    title: item.title,
    url: item.url ?? '',
    author: item.author ?? label,
    summary: truncate(item.summary, 300),
    feed: label,
    date: item.publishedAt ? timestamp(item.publishedAt, 'f') : '',
  };
}

export function buildPost(feed: FeedSource, item: FeedItem, label: string): OutgoingMessage {
  const values = itemValues(item, label);
  const template = feed.template.trim() || (feed.embed ? '' : copy.templates[feed.type]);
  const body = template ? renderTemplate(template, values).trim() : '';
  const ping = feed.pingRoleId ? mention.role(feed.pingRoleId) : '';
  const content = truncate([ping, body].filter(Boolean).join(' '), 4000);

  const message: OutgoingMessage = {
    content: content || undefined,
    mentionRoles: feed.pingRoleId ? [feed.pingRoleId] : [],
  };

  if (feed.embed) {
    const typeLabel = copy.labels[feed.type];
    const embed: Embed = {
      color: palette.south,
      author: { name: truncate(item.author && item.author !== label ? item.author : label, 256) },
      title: truncate(item.title, 256),
      url: item.url ?? undefined,
      description: item.summary ? truncate(item.summary, 350) : undefined,
      imageUrl: item.imageUrl ?? undefined,
      footer: typeLabel !== label ? truncate(`${label} / ${typeLabel}`, 2048) : label,
      timestamp: item.publishedAt ?? undefined,
    };
    message.embeds = [embed];
  }

  return message;
}

export interface Selection {
  post: FeedItem[];
  skipped: number;
}

export function selectNew(
  items: readonly FeedItem[],
  seen: ReadonlySet<string>,
  primedAt: Date | null,
  max = MAX_POSTS_PER_POLL,
): Selection {
  const cutoff = primedAt ? primedAt.getTime() - BACKLOG_GRACE : null;
  const fresh = items.filter((item) => {
    if (seen.has(item.id)) return false;
    if (cutoff !== null && item.publishedAt && item.publishedAt.getTime() < cutoff) return false;
    return true;
  });
  const ordered = fresh
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const at = a.item.publishedAt?.getTime();
      const bt = b.item.publishedAt?.getTime();
      if (at !== undefined && bt !== undefined && at !== bt) return at - bt;
      return b.index - a.index;
    })
    .map((entry) => entry.item);
  const post = ordered.slice(-max);
  return { post, skipped: ordered.length - post.length };
}

export function backoff(intervalMinutes: number, failures: number): number {
  const base = intervalMinutes * 60_000;
  const factor = 2 ** Math.min(Math.max(failures, 0), 6);
  return Math.min(base * factor, 24 * 60 * 60 * 1000);
}
