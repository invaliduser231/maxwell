import { z } from 'zod';
import { defineModule } from './types.js';

export const INSIGHTS_RETENTION_DEFAULT = 365;

export const insightsConfig = z.object({
  excludedChannels: z.array(z.string()).max(200).default([]),
  countBots: z.boolean().default(false),
  trackVoice: z.boolean().default(true),
  retentionDays: z.number().int().min(30).max(730).default(INSIGHTS_RETENTION_DEFAULT),
  digestChannelId: z.string().nullable().default(null),
  digestDay: z.number().int().min(0).max(6).default(0),
  digestHour: z.number().int().min(0).max(23).default(9),
});

export type InsightsConfig = z.output<typeof insightsConfig>;

export const moderationModules = ['moderation', 'automod'] as const;

export const NATIVE_MODULE = 'native';
export const nativeActions = ['ban', 'kick'] as const;
export type NativeAction = (typeof nativeActions)[number];

export const digestActions = ['warn', 'timeout', 'kick', 'ban'] as const;
export type DigestAction = (typeof digestActions)[number];

export default defineModule({
  key: 'insights',
  name: 'Insights',
  description: 'Activity, retention and moderation stats.',
  group: 'tools',
  pole: 'south',
  voteLocked: true,
  defaultEnabled: false,
  toggleable: true,
  config: insightsConfig,
  migrations: [
    {
      id: '1-rollups',
      up: `
        create table insights_messages (
          guild_id bigint not null,
          hour timestamptz not null,
          channel_id bigint not null,
          messages integer not null default 0,
          primary key (guild_id, hour, channel_id)
        );

        create table insights_active (
          guild_id bigint not null,
          day date not null,
          user_id bigint not null,
          messages integer not null default 0,
          primary key (guild_id, day, user_id)
        );

        create index insights_active_user on insights_active (guild_id, user_id, day);

        create table insights_members (
          guild_id bigint not null,
          day date not null,
          joins integer not null default 0,
          leaves integer not null default 0,
          primary key (guild_id, day)
        );

        create table insights_voice (
          guild_id bigint not null,
          day date not null,
          channel_id bigint not null,
          seconds integer not null default 0,
          primary key (guild_id, day, channel_id)
        );
      `,
    },
    {
      id: '2-native-moderation',
      up: `
        create table insights_moderation (
          guild_id bigint not null,
          day date not null,
          action text not null,
          actor_id bigint not null default 0,
          count integer not null default 0,
          primary key (guild_id, day, action, actor_id)
        );

        create index insights_moderation_actor on insights_moderation (guild_id, actor_id);
      `,
    },
    {
      id: '3-digests',
      up: `
        create table insights_digests (
          guild_id bigint not null,
          week text not null,
          channel_id bigint not null,
          posted_at timestamptz not null default now(),
          primary key (guild_id, week)
        );
      `,
    },
  ],
});
