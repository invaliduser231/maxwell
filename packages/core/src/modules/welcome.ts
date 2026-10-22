import { z } from 'zod';
import { defineModule } from './types.js';

const id = z.string().regex(/^\d{1,21}$/);

export const welcomeVariables = [
  'user',
  'name',
  'username',
  'id',
  'server',
  'count',
  'ordinal',
  'created',
] as const;

export const welcomeConfig = z.object({
  ignoreBots: z.boolean().default(true),
  join: z
    .object({
      enabled: z.boolean().default(true),
      channelId: id.nullable().default(null),
      message: z.string().max(2000).default('Welcome to **{server}**, {user}.'),
      ping: z.boolean().default(true),
      card: z.boolean().default(false),
      cardTitle: z.string().max(80).default('Welcome, {name}'),
      cardSubtitle: z.string().max(120).default('Member #{count}'),
    })
    .prefault({}),
  dm: z
    .object({
      enabled: z.boolean().default(false),
      message: z
        .string()
        .max(2000)
        .default('Welcome to **{server}**. Have a look around and say hi.'),
    })
    .prefault({}),
  leave: z
    .object({
      enabled: z.boolean().default(false),
      channelId: id.nullable().default(null),
      message: z.string().max(2000).default('**{name}** left. {count} members now.'),
      card: z.boolean().default(false),
      cardTitle: z.string().max(80).default('Goodbye, {name}'),
      cardSubtitle: z.string().max(120).default('{count} members now'),
    })
    .prefault({}),
  rules: z
    .object({
      enabled: z.boolean().default(false),
      channelId: id.nullable().default(null),
      messageId: id.nullable().default(null),
      title: z.string().max(256).default('Rules'),
      content: z
        .string()
        .max(3800)
        .default('1. Be kind.\n2. No spam or ads.\n3. Keep it on topic.'),
      emoji: z.string().min(1).max(80).default('✅'),
      roleId: id.nullable().default(null),
      removeOnUnreact: z.boolean().default(false),
    })
    .prefault({}),
  delayedRoles: z
    .array(
      z.object({
        roleId: id,
        delayMinutes: z
          .number()
          .int()
          .min(1)
          .max(60 * 24 * 30),
      }),
    )
    .max(10)
    .default([]),
});

export type WelcomeConfig = z.infer<typeof welcomeConfig>;

export default defineModule({
  key: 'welcome',
  name: 'Welcome',
  description: 'Messages, cards and roles for new members.',
  group: 'community',
  pole: 'north',
  voteLocked: false,
  defaultEnabled: false,
  toggleable: true,
  config: welcomeConfig,
  migrations: [
    {
      id: '1-rules',
      up: `
        create table welcome_rules (
          guild_id bigint primary key,
          channel_id bigint not null,
          message_id bigint not null,
          published_at timestamptz not null default now()
        );

        create table welcome_accepted (
          guild_id bigint not null,
          user_id bigint not null,
          accepted_at timestamptz not null default now(),
          primary key (guild_id, user_id)
        );
      `,
    },
  ],
});
