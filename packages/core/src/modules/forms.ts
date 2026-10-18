import { z } from 'zod';
import { defineModule } from './types.js';

const slug = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9-]+$/);

export const formQuestionTypes = ['text', 'choice', 'number', 'yesno'] as const;
export const formConditionOperators = [
  'equals',
  'notEquals',
  'includes',
  'greaterThan',
  'lessThan',
] as const;

export const formCondition = z.object({
  questionId: slug,
  operator: z.enum(formConditionOperators).default('equals'),
  value: z.string().max(200).default(''),
});

export const formQuestion = z.object({
  id: slug,
  label: z.string().min(1).max(256),
  description: z.string().max(500).default(''),
  type: z.enum(formQuestionTypes).default('text'),
  required: z.boolean().default(true),
  options: z.array(z.string().min(1).max(100)).max(20).default([]),
  min: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
  condition: formCondition.nullable().default(null),
});

export const formAction = z.object({
  addRoleIds: z.array(z.string()).max(10).default([]),
  removeRoleIds: z.array(z.string()).max(10).default([]),
  openTicket: z.boolean().default(false),
  ticketPanelId: z.string().nullable().default(null),
  dm: z.string().max(2000).default(''),
});

export const formDefinition = z.object({
  id: slug,
  name: z.string().min(1).max(80),
  description: z.string().max(1000).default(''),
  enabled: z.boolean().default(true),
  questions: z.array(formQuestion).max(25).default([]),
  requiredRoleIds: z.array(z.string()).max(10).default([]),
  cooldownHours: z.number().int().min(0).max(8760).default(0),
  oncePerMember: z.boolean().default(false),
  reviewChannelId: z.string().nullable().default(null),
  reviewerRoleIds: z.array(z.string()).max(10).default([]),
  votesToAccept: z.number().int().min(0).max(25).default(0),
  votesToDecline: z.number().int().min(0).max(25).default(0),
  onAccept: formAction.prefault({}),
  onDecline: formAction.prefault({}),
});

export const formsConfig = z.object({
  forms: z.array(formDefinition).max(25).default([]),
  fallbackCategoryId: z.string().nullable().default(null),
  sessionMinutes: z.number().int().min(5).max(1440).default(30),
});

export type FormsConfig = z.output<typeof formsConfig>;
export type FormDefinition = z.output<typeof formDefinition>;
export type FormQuestion = z.output<typeof formQuestion>;
export type FormCondition = z.output<typeof formCondition>;
export type FormAction = z.output<typeof formAction>;
export type FormQuestionType = (typeof formQuestionTypes)[number];

export default defineModule({
  key: 'forms',
  name: 'Forms',
  description: 'Applications and forms with actions.',
  group: 'community',
  pole: 'north',
  voteLocked: true,
  defaultEnabled: false,
  toggleable: true,
  config: formsConfig,
  migrations: [
    {
      id: '1-forms',
      up: `
        create table forms_sessions (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          form_id text not null,
          user_id bigint not null unique,
          mode text not null,
          channel_id bigint,
          question_id text,
          answers jsonb not null default '{}',
          started_at timestamptz not null default now(),
          expires_at timestamptz not null
        );

        create index forms_sessions_channel on forms_sessions (channel_id) where channel_id is not null;

        create table forms_submissions (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          form_id text not null,
          form_name text not null,
          user_id bigint not null,
          answers jsonb not null default '[]',
          status text not null default 'pending',
          review_channel_id bigint,
          review_message_id bigint unique,
          decided_by bigint,
          decided_at timestamptz,
          note text,
          applied jsonb,
          created_at timestamptz not null default now()
        );

        create index forms_submissions_guild on forms_submissions (guild_id, status, created_at desc);
        create index forms_submissions_member on forms_submissions (guild_id, form_id, user_id, created_at desc);

        create table forms_votes (
          submission_id bigint not null references forms_submissions (id) on delete cascade,
          user_id bigint not null,
          vote text not null,
          created_at timestamptz not null default now(),
          primary key (submission_id, user_id)
        );
      `,
    },
    {
      id: '2-numbers',
      up: `
        alter table forms_submissions add column number integer;
        update forms_submissions s set number = ranked.n
        from (
          select id, row_number() over (partition by guild_id order by id) as n from forms_submissions
        ) ranked
        where ranked.id = s.id;
        alter table forms_submissions alter column number set not null;
        create unique index forms_submissions_number on forms_submissions (guild_id, number);
      `,
    },
  ],
});
