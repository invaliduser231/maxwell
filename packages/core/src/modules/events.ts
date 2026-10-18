import { z } from 'zod';
import { defineModule } from './types.js';

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const emoji = z.string().min(1).max(80);

export const recurrences = ['none', 'daily', 'weekly', 'monthly'] as const;

export type Recurrence = (typeof recurrences)[number];

export const rsvpConfig = z.object({
  going: emoji.default('✅'),
  maybe: emoji.default('❔'),
  no: emoji.default('❌'),
});

export const eventsConfig = z.object({
  channelId: z.string().nullable().default(null),
  pollChannelId: z.string().nullable().default(null),
  timezone: z.string().refine(isTimezone).nullable().default(null),
  defaultDurationMinutes: z.number().int().min(5).max(10_080).default(120),
  reminderMinutes: z.number().int().min(0).max(10_080).default(60),
  rsvp: rsvpConfig.default({ going: '✅', maybe: '❔', no: '❌' }),
  pollDurationMinutes: z.number().int().min(0).max(43_200).default(1_440),
  pollResultImage: z.boolean().default(true),
  voteReceipts: z.boolean().default(true),
  rewardAmount: z.number().int().min(0).max(1_000_000).default(0),
});

export type EventsConfig = z.infer<typeof eventsConfig>;

export default defineModule({
  key: 'events',
  name: 'Events and polls',
  description: 'Events with RSVP, and polls.',
  group: 'community',
  pole: 'north',
  voteLocked: false,
  defaultEnabled: false,
  toggleable: true,
  config: eventsConfig,
  migrations: [
    {
      id: '1-events',
      up: `
        create table events_events (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          title text not null,
          description text not null default '',
          anchor_at timestamptz not null,
          starts_at timestamptz not null,
          sequence integer not null default 0,
          duration_minutes integer,
          timezone text not null default 'UTC',
          recurrence text not null default 'none',
          location text,
          voice_channel_id bigint,
          channel_id bigint,
          ping_role_id bigint,
          message_id bigint,
          status text not null default 'scheduled',
          created_by bigint,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        create index events_events_guild on events_events (guild_id, starts_at);
        create index events_events_message on events_events (message_id) where message_id is not null;

        create table events_rsvps (
          event_id bigint not null references events_events (id) on delete cascade,
          sequence integer not null,
          guild_id bigint not null,
          user_id bigint not null,
          status text not null,
          updated_at timestamptz not null default now(),
          primary key (event_id, sequence, user_id)
        );

        create index events_rsvps_user on events_rsvps (guild_id, user_id);
      `,
    },
    {
      id: '2-polls',
      up: `
        create table events_polls (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          question text not null,
          options jsonb not null,
          anonymous boolean not null default false,
          multiple boolean not null default false,
          ends_at timestamptz,
          channel_id bigint,
          message_id bigint,
          status text not null default 'draft',
          created_by bigint,
          created_at timestamptz not null default now(),
          closed_at timestamptz
        );

        create index events_polls_guild on events_polls (guild_id, created_at desc);
        create index events_polls_message on events_polls (message_id) where message_id is not null;

        create table events_poll_votes (
          poll_id bigint not null references events_polls (id) on delete cascade,
          guild_id bigint not null,
          user_id bigint not null,
          option smallint not null,
          created_at timestamptz not null default now(),
          primary key (poll_id, user_id, option)
        );

        create index events_poll_votes_user on events_poll_votes (guild_id, user_id);
      `,
    },
    {
      id: '3-numbers',
      up: `
        alter table events_events add column number integer;
        update events_events e set number = ranked.n
        from (
          select id, row_number() over (partition by guild_id order by id) as n from events_events
        ) ranked
        where ranked.id = e.id;
        alter table events_events alter column number set not null;
        create unique index events_events_number on events_events (guild_id, number);

        alter table events_polls add column number integer;
        update events_polls p set number = ranked.n
        from (
          select id, row_number() over (partition by guild_id order by id) as n from events_polls
        ) ranked
        where ranked.id = p.id;
        alter table events_polls alter column number set not null;
        create unique index events_polls_number on events_polls (guild_id, number);
      `,
    },
  ],
});
