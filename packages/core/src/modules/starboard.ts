import { z } from 'zod';
import { defineModule } from './types.js';

const id = z.string().regex(/^\d{1,21}$/);

export const starboardConfig = z.object({
  channelId: id.nullable().default(null),
  emoji: z.string().min(1).max(80).default('⭐'),
  threshold: z.number().int().min(1).max(100).default(3),
  selfStar: z.boolean().default(false),
  allowBots: z.boolean().default(false),
  excludeNsfw: z.boolean().default(true),
  ignoredChannelIds: z.array(id).max(100).default([]),
  removeBelowThreshold: z.boolean().default(true),
});

export type StarboardConfig = z.infer<typeof starboardConfig>;

export default defineModule({
  key: 'starboard',
  name: 'Starboard',
  description: 'Highlights the most starred messages.',
  group: 'community',
  pole: 'north',
  voteLocked: false,
  defaultEnabled: false,
  toggleable: true,
  config: starboardConfig,
  migrations: [
    {
      id: '1-posts',
      up: `
        create table starboard_posts (
          message_id bigint primary key,
          guild_id bigint not null,
          channel_id bigint not null,
          author_id bigint not null,
          post_id bigint,
          post_image boolean not null default false,
          stars integer not null default 0,
          content text not null default '',
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        create index starboard_posts_top on starboard_posts (guild_id, stars desc);
        create unique index starboard_posts_post on starboard_posts (post_id) where post_id is not null;
      `,
    },
  ],
});
