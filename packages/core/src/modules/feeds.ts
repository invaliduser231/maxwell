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
  youtube: 'UCxxxxxxxxxxxxxxxxxxxxxx',
  twitch: 'channel name',
  reddit: 'subreddit',
  bluesky: 'handle.bsky.social',
  github: 'owner/repo',
  fluxer: '',
};

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
