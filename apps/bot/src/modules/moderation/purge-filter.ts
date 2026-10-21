import { userId } from '../../commands/mentions.js';
import type { IncomingMessage } from '../../platform/types.js';

export interface PurgeFilter {
  users: string[];
  bots: boolean;
  links: boolean;
  contains: string | null;
}

export type PurgeParse = { ok: true; filter: PurgeFilter } | { ok: false; token: string };

const LINK = /(https?:\/\/|www\.)\S+/i;

export function emptyFilter(): PurgeFilter {
  return { users: [], bots: false, links: false, contains: null };
}

export function parsePurgeFilter(input: string | undefined): PurgeParse {
  const filter = emptyFilter();
  const text = input?.trim() ?? '';
  if (!text) return { ok: true, filter };

  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string;
    const lower = word.toLowerCase();
    if (lower === 'bots' || lower === 'bot') {
      filter.bots = true;
      continue;
    }
    if (lower === 'links' || lower === 'link') {
      filter.links = true;
      continue;
    }
    if (lower === 'contains' || lower.startsWith('contains:')) {
      const inline = word.slice('contains'.length + 1);
      const rest = [inline, ...words.slice(i + 1)].filter(Boolean).join(' ');
      const needle = rest.replace(/^["']|["']$/g, '').trim();
      if (!needle) return { ok: false, token: word };
      filter.contains = needle.toLowerCase();
      break;
    }
    const id = userId(word);
    if (id) {
      if (!filter.users.includes(id)) filter.users.push(id);
      continue;
    }
    return { ok: false, token: word };
  }
  return { ok: true, filter };
}

export function hasFilter(filter: PurgeFilter): boolean {
  return filter.users.length > 0 || filter.bots || filter.links || filter.contains !== null;
}

export function matchesPurge(message: IncomingMessage, filter: PurgeFilter): boolean {
  if (filter.users.length > 0 && !filter.users.includes(message.author.id)) return false;
  if (filter.bots && !(message.author.bot || message.fromWebhook)) return false;
  if (filter.links && !LINK.test(message.content)) return false;
  if (filter.contains !== null && !message.content.toLowerCase().includes(filter.contains))
    return false;
  return true;
}
