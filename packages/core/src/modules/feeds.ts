import { z } from 'zod';
import { defineModule } from './types.js';

export const feedTypes = [
  'rss',
  'youtube',
  'twitch',
  'reddit',
  'bluesky',
  'github',
  'fluxer',
] as const;

export type FeedType = (typeof feedTypes)[number];

export const FEED_LIMIT = 30;

export const feedTemplateVariables = ['title', 'url', 'author', 'summary', 'feed', 'date'] as const;

export const feedSource = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(feedTypes).default('rss'),
  source: z.string().max(500).default(''),
  name: z.string().max(80).default(''),
  channelId: z.string().nullable().default(null),
  template: z.string().max(2000).default(''),
  embed: z.boolean().default(true),
  pingRoleId: z.string().nullable().default(null),
  include: z.array(z.string().min(1).max(100)).max(50).default([]),
  exclude: z.array(z.string().min(1).max(100)).max(50).default([]),
  interval: z.number().int().min(5).max(1440).default(15),
  shorts: z.boolean().default(true),
  reposts: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

export type FeedSource = z.output<typeof feedSource>;

export const feedsConfig = z.object({
  feeds: z.array(feedSource).max(FEED_LIMIT).default([]),
});

export type FeedsConfig = z.output<typeof feedsConfig>;

export const feedSourceHints: Record<FeedType, string> = {
  rss: 'https://example.com/feed.xml',
  youtube: 'https://www.youtube.com/@channel',
  twitch: 'channel name',
  reddit: 'subreddit',
  bluesky: 'handle.bsky.social',
  github: 'owner/repo',
  fluxer: '',
};

export const FLUXER_BLOG_FEED = 'https://fluxer.app/blog/rss.xml';

function stripUrl(input: string, host: RegExp): string {
  const value = input.trim();
  try {
    const url = new URL(value);
    if (!host.test(url.hostname)) return '';
    return url.pathname.replace(/^\/+|\/+$/g, '');
  } catch {
    return value.replace(/^@/, '').replace(/^\/+|\/+$/g, '');
  }
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function youtubeFeed(input: string): string | null {
  const value = input.trim();
  const direct = /^(UC[\w-]{22})$/.exec(value)?.[1];
  if (direct) return `https://www.youtube.com/feeds/videos.xml?channel_id=${direct}`;
  const playlist = /^(PL[\w-]{10,40})$/.exec(value)?.[1];
  if (playlist) return `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlist}`;
  const url = parseUrl(value);
  if (!url || !/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
  const channel =
    /\/channel\/(UC[\w-]{22})/.exec(url.pathname)?.[1] ?? url.searchParams.get('channel_id');
  if (channel && /^UC[\w-]{22}$/.test(channel)) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`;
  }
  const list = url.searchParams.get('list') ?? url.searchParams.get('playlist_id');
  if (list && /^PL[\w-]{10,40}$/.test(list) && !url.searchParams.get('v')) {
    return `https://www.youtube.com/feeds/videos.xml?playlist_id=${list}`;
  }
  return null;
}

export function youtubePage(input: string): string | null {
  const value = input.trim();
  const bare = /^@([\w.-]{3,30})$/.exec(value)?.[1];
  if (bare) return `https://www.youtube.com/@${bare}`;
  const url = parseUrl(value);
  if (!url) return null;
  const video = /^[\w-]{11}$/;
  if (/^(www\.)?youtu\.be$/i.test(url.hostname)) {
    const id = url.pathname.slice(1).split('/')[0] ?? '';
    return video.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
  }
  if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
  const watched = url.pathname === '/watch' ? (url.searchParams.get('v') ?? '') : '';
  if (video.test(watched)) return `https://www.youtube.com/watch?v=${watched}`;
  const clip = /^\/(?:shorts|live)\/([\w-]{11})(?:\/|$)/.exec(url.pathname)?.[1];
  if (clip) return `https://www.youtube.com/watch?v=${clip}`;
  const match = /^\/(@[\w.-]{3,30}|c\/[\w.-]{1,100}|user\/[\w.-]{1,100})(?:\/|$)/.exec(
    url.pathname,
  );
  return match?.[1] ? `https://www.youtube.com/${match[1]}` : null;
}

export function redditFeed(input: string): string | null {
  const path = stripUrl(input, /(^|\.)reddit\.com$/i);
  const name = /^(?:r\/)?([A-Za-z0-9_]{2,21})(?:\/.*)?$/.exec(path)?.[1];
  return name ? `https://www.reddit.com/r/${name}/new/.rss` : null;
}

export function githubFeed(input: string): string | null {
  const path = stripUrl(input, /^(www\.)?github\.com$/i);
  const match = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})(?:\/.*)?$/.exec(path);
  if (!match?.[1] || !match[2]) return null;
  const repo = match[2].replace(/\.git$/, '');
  return `https://github.com/${match[1]}/${repo}/releases.atom`;
}

export function blueskyActor(input: string): string | null {
  const path = stripUrl(input, /^(www\.)?bsky\.app$/i);
  const actor = path.replace(/^profile\//, '').split('/')[0] ?? '';
  if (/^did:plc:[a-z2-7]{24}$/.test(actor)) return actor;
  if (/^([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i.test(actor)) return actor.toLowerCase();
  return null;
}

export function twitchLogin(input: string): string | null {
  const path = stripUrl(input, /(^|\.)twitch\.tv$/i);
  const login = path.split('/')[0] ?? '';
  return /^[A-Za-z0-9_]{3,25}$/.test(login) ? login.toLowerCase() : null;
}

export function rssFeed(input: string): string | null {
  const url = parseUrl(input.trim());
  return url?.protocol === 'https:' ? url.toString() : null;
}

export function resolveSource(type: FeedType, source: string): string | null {
  switch (type) {
    case 'rss':
      return rssFeed(source);
    case 'youtube':
      return youtubeFeed(source);
    case 'reddit':
      return redditFeed(source);
    case 'github':
      return githubFeed(source);
    case 'fluxer':
      return FLUXER_BLOG_FEED;
    case 'bluesky':
      return blueskyActor(source);
    case 'twitch':
      return twitchLogin(source);
  }
}

export function feedSourceValid(type: FeedType, source: string): boolean {
  if (resolveSource(type, source)) return true;
  return type === 'youtube' && youtubePage(source) !== null;
}

export default defineModule({
  key: 'feeds',
  name: 'Feeds',
  description: 'RSS, YouTube, Twitch and more in your channels.',
  group: 'tools',
  pole: 'south',
  voteLocked: true,
  defaultEnabled: false,
  toggleable: true,
  config: feedsConfig,
  migrations: [
    {
      id: '1-state',
      up: `
        create table feeds_state (
          guild_id bigint not null,
          feed_id text not null,
          source_key text not null,
          seen text[] not null default '{}',
          etag text,
          last_modified text,
          primed_at timestamptz,
          last_polled_at timestamptz,
          next_poll_at timestamptz not null default now(),
          last_item_at timestamptz,
          last_posted_at timestamptz,
          failures integer not null default 0,
          last_error text,
          paused_at timestamptz,
          posted integer not null default 0,
          primary key (guild_id, feed_id)
        );

        create table feeds_posts (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          feed_id text not null,
          item_id text not null,
          title text not null,
          url text,
          channel_id bigint not null,
          message_id bigint,
          posted_at timestamptz not null default now()
        );

        create index feeds_posts_feed on feeds_posts (guild_id, feed_id, posted_at desc);
      `,
    },
  ],
});
