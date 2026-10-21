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

export const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export type Weekday = (typeof weekdays)[number];

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const localDateTime = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/);

export const scheduleRule = z.discriminatedUnion('type', [
  z.object({ type: z.literal('once'), at: localDateTime }),
  z.object({
    type: z.literal('interval'),
    hours: z.number().int().min(1).max(720),
    start: localDateTime,
  }),
  z.object({ type: z.literal('daily'), time: clock }),
  z.object({
    type: z.literal('weekly'),
    days: z.array(z.enum(weekdays)).min(1).max(7),
    time: clock,
  }),
]);

export type ScheduleRule = z.infer<typeof scheduleRule>;

export const scheduledMessage = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/i),
  name: z.string().max(100).default(''),
  enabled: z.boolean().default(true),
  channelId: z.string(),
  content: z.string().min(1).max(2_000),
  embed: z.boolean().default(false),
  pingRoleId: z.string().nullable().default(null),
  rule: scheduleRule,
});

export type ScheduledMessage = z.infer<typeof scheduledMessage>;

export const schedulerConfig = z.object({
  timezone: z.string().refine(isTimezone).nullable().default(null),
  messages: z
    .array(scheduledMessage)
    .max(25)
    .refine((list) => new Set(list.map((message) => message.id)).size === list.length)
    .default([]),
  reminders: z.boolean().default(true),
  reminderDelivery: z.enum(['channel', 'dm']).default('channel'),
  maxRemindersPerMember: z.number().int().min(1).max(100).default(25),
  maxReminderDays: z.number().int().min(1).max(730).default(365),
});

export type SchedulerConfig = z.infer<typeof schedulerConfig>;

export default defineModule({
  key: 'scheduler',
  name: 'Scheduler',
  description: 'Scheduled and repeating messages.',
  group: 'tools',
  pole: 'south',
  voteLocked: false,
  defaultEnabled: false,
  toggleable: true,
  config: schedulerConfig,
  migrations: [
    {
      id: '1-scheduler',
      up: `
        create table scheduler_reminders (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          channel_id bigint not null,
          user_id bigint not null,
          content text not null,
          due_at timestamptz not null,
          created_at timestamptz not null default now()
        );

        create index scheduler_reminders_user on scheduler_reminders (guild_id, user_id, due_at);
        create index scheduler_reminders_due on scheduler_reminders (guild_id, due_at);

        create table scheduler_message_state (
          guild_id bigint not null,
          message_id text not null,
          next_run_at timestamptz,
          last_sent_at timestamptz,
          last_error text,
          updated_at timestamptz not null default now(),
          primary key (guild_id, message_id)
        );
      `,
    },
    {
      id: '2-numbers',
      up: `
        alter table scheduler_reminders add column number integer;
        update scheduler_reminders r set number = ranked.n
        from (
          select id, row_number() over (partition by guild_id order by id) as n
          from scheduler_reminders
        ) ranked
        where ranked.id = r.id;
        alter table scheduler_reminders alter column number set not null;
        create unique index scheduler_reminders_number on scheduler_reminders (guild_id, number);
      `,
    },
  ],
});
