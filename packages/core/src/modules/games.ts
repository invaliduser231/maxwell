import { z } from 'zod';
import { defineModule } from './types.js';

const snowflake = z.string().regex(/^\d{1,21}$/);

export const games = ['trivia', 'counting', 'wordchain', 'higherlower', 'coinflip'] as const;
export type GameKey = (typeof games)[number];

export const triviaQuestion = z.object({
  question: z.string().trim().min(1).max(300),
  answers: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  choices: z.array(z.string().trim().min(1).max(100)).max(6).default([]),
});

export type TriviaQuestion = z.infer<typeof triviaQuestion>;

export const gamesConfig = z.object({
  channelIds: z.array(snowflake).max(25).default([]),
  trivia: z
    .object({
      enabled: z.boolean().default(true),
      answerSeconds: z.number().int().min(10).max(300).default(30),
      questions: z.array(triviaQuestion).max(500).default([]),
    })
    .prefault({}),
  counting: z
    .object({
      enabled: z.boolean().default(false),
      channelId: snowflake.nullable().default(null),
      resetOnMistake: z.boolean().default(true),
      allowSameUser: z.boolean().default(false),
      rewardEvery: z.number().int().min(0).max(100_000).default(100),
    })
    .prefault({}),
  wordchain: z
    .object({
      enabled: z.boolean().default(false),
      channelId: snowflake.nullable().default(null),
      minLength: z.number().int().min(1).max(20).default(3),
      allowRepeat: z.boolean().default(false),
      allowSameUser: z.boolean().default(false),
      resetOnMistake: z.boolean().default(true),
    })
    .prefault({}),
  higherLower: z
    .object({
      enabled: z.boolean().default(true),
      max: z.number().int().min(10).max(1_000).default(100),
      edge: z.number().min(0).max(0.5).default(0.05),
      maxMultiplier: z.number().min(1).max(100).default(10),
      timeoutSeconds: z.number().int().min(15).max(600).default(60),
    })
    .prefault({}),
  coinflip: z
    .object({
      enabled: z.boolean().default(true),
      expirySeconds: z.number().int().min(15).max(600).default(60),
    })
    .prefault({}),
  stakes: z
    .object({
      min: z.number().int().min(1).max(1_000_000_000).default(10),
      max: z.number().int().min(1).max(1_000_000_000).default(5_000),
    })
    .prefault({}),
});

export type GamesConfig = z.infer<typeof gamesConfig>;

export default defineModule({
  key: 'games',
  name: 'Games',
  description: 'Trivia, counting and other small games.',
  group: 'play',
  pole: 'north',
  voteLocked: false,
  defaultEnabled: false,
  toggleable: true,
  config: gamesConfig,
  migrations: [
    {
      id: '1-games',
      up: `
        create table games_scores (
          guild_id bigint not null,
          game text not null,
          user_id bigint not null,
          wins integer not null default 0,
          plays integer not null default 0,
          best integer not null default 0,
          net bigint not null default 0,
          updated_at timestamptz not null default now(),
          primary key (guild_id, game, user_id)
        );

        create index games_scores_board on games_scores (guild_id, game, wins desc);

        create table games_channels (
          guild_id bigint not null,
          channel_id bigint not null,
          game text not null,
          current integer not null default 0,
          last_word text,
          last_user bigint,
          high_score integer not null default 0,
          used text[] not null default '{}',
          updated_at timestamptz not null default now(),
          primary key (guild_id, channel_id, game)
        );

        create table games_hilo (
          guild_id bigint not null,
          user_id bigint not null,
          channel_id bigint not null,
          current integer not null,
          streak integer not null default 0,
          stake bigint not null default 0,
          multiplier double precision not null default 1,
          expires_at timestamptz not null,
          primary key (guild_id, user_id)
        );

        create table games_duels (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          channel_id bigint not null,
          message_id bigint,
          challenger bigint not null,
          opponent bigint not null,
          stake bigint not null,
          status text not null default 'open',
          winner bigint,
          created_at timestamptz not null default now(),
          expires_at timestamptz not null
        );

        create index games_duels_message on games_duels (message_id) where status = 'open';
      `,
    },
    {
      id: '2-trivia',
      up: `
        create table games_trivia (
          channel_id bigint primary key,
          guild_id bigint not null,
          session_id text not null,
          question jsonb not null,
          expires_at timestamptz not null,
          created_at timestamptz not null default now()
        );
      `,
    },
  ],
});
