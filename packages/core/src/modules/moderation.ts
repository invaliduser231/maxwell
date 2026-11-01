import { z } from 'zod';
import { defineModule } from './types.js';

export const caseActions = [
  'ban',
  'unban',
  'kick',
  'timeout',
  'untimeout',
  'warn',
  'flag',
] as const;

export type CaseAction = (typeof caseActions)[number];

export const escalationActions = ['timeout', 'kick', 'ban'] as const;

export type EscalationAction = (typeof escalationActions)[number];

export const dmActions = ['warn', 'timeout', 'kick', 'ban'] as const;

export const escalationStep = z.object({
  warns: z.number().int().min(1).max(100),
  action: z.enum(escalationActions),
  durationMinutes: z.number().int().min(1).max(525_960).nullable().default(null),
  review: z.boolean().default(false),
});

export type EscalationStep = z.output<typeof escalationStep>;

export const inboxKinds = ['report', 'appeal', 'review', 'gate', 'check'] as const;

export type InboxKind = (typeof inboxKinds)[number];

export const inboxStatuses = ['open', 'claimed', 'resolved', 'dismissed'] as const;

export type InboxStatus = (typeof inboxStatuses)[number];

export const defaultDmTemplate =
  'You were {action} in **{server}**.\nReason: {reason}\n-# Questions go to the server staff, not to me.';

export const defaultEscalation: EscalationStep[] = [
  { warns: 3, action: 'timeout', durationMinutes: 60, review: false },
  { warns: 5, action: 'timeout', durationMinutes: 1_440, review: false },
  { warns: 7, action: 'ban', durationMinutes: null, review: true },
];

export const MASS_BAN_MAX = 200;

export const reasonTemplate = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_-]{0,23}$/),
  text: z.string().trim().min(1).max(500),
  timeoutMinutes: z.number().int().min(1).max(525_960).nullable().default(null),
  deleteMessages: z.boolean().default(false),
});

export type ReasonTemplate = z.output<typeof reasonTemplate>;

export const defaultReasonTemplates: ReasonTemplate[] = [
  { key: 'spam', text: 'Spam', timeoutMinutes: 60, deleteMessages: true },
  {
    key: 'ads',
    text: 'Advertising without permission',
    timeoutMinutes: null,
    deleteMessages: true,
  },
  { key: 'nsfw', text: 'NSFW content', timeoutMinutes: 1_440, deleteMessages: true },
  {
    key: 'toxic',
    text: 'Insulting or harassing other members',
    timeoutMinutes: 1_440,
    deleteMessages: false,
  },
];

export function findTemplate(
  templates: readonly ReasonTemplate[],
  reason: string | null | undefined,
): ReasonTemplate | null {
  const key = reason?.trim().toLowerCase();
  if (!key) return null;
  return templates.find((template) => template.key === key) ?? null;
}

const memberToken = /^(?:<@!?(\d{15,21})>|(\d{15,21}))$/;

export function memberIdOf(token: string): string | null {
  const match = memberToken.exec(token);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

export interface MemberIdList {
  ids: string[];
  invalid: string[];
}

export function parseMemberIds(text: string): MemberIdList {
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const token of text.split(/[\s,;]+/)) {
    if (!token) continue;
    const id = memberIdOf(token);
    if (!id) {
      if (!invalid.includes(token)) invalid.push(token);
    } else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, invalid };
}

export function splitMassBan(text: string): { ids: string[]; reason: string | null } {
  const ids: string[] = [];
  let rest = text;
  for (;;) {
    const match = /^[\s,;]*(\S+?)(?=[\s,;]|$)/.exec(rest);
    const token = match?.[1];
    const id = token ? memberIdOf(token) : null;
    if (!match || !id) break;
    if (!ids.includes(id)) ids.push(id);
    rest = rest.slice(match[0].length);
  }
  const reason = rest.replace(/^[\s,;]+/, '').trim();
  return { ids, reason: reason || null };
}

export const moderationConfig = z.object({
  logChannelId: z.string().nullable().default(null),
  modRoleIds: z.array(z.string()).max(25).default([]),
  requireReason: z.boolean().default(false),
  dmMembers: z.boolean().default(true),
  dmActions: z.array(z.enum(dmActions)).default([...dmActions]),
  dmTemplate: z.string().min(1).max(1_500).default(defaultDmTemplate),
  defaultTimeoutMinutes: z.number().int().min(1).max(525_960).default(60),
  banDeleteMessageDays: z.number().int().min(0).max(7).default(0),
  warnExpiryDays: z.number().int().min(1).max(3_650).nullable().default(90),
  escalationEnabled: z.boolean().default(true),
  escalationWindowDays: z.number().int().min(1).max(365).default(30),
  escalationSteps: z.array(escalationStep).max(10).default(defaultEscalation),
  inboxChannelId: z.string().nullable().default(null),
  reports: z.boolean().default(true),
  reportEmoji: z.string().min(1).max(100).nullable().default(null),
  appeals: z.boolean().default(false),
  reasonTemplates: z
    .array(reasonTemplate)
    .max(25)
    .refine(
      (list) => new Set(list.map((template) => template.key)).size === list.length,
      'Each template needs its own key.',
    )
    .default(defaultReasonTemplates),
});

export type ModerationConfig = z.output<typeof moderationConfig>;

export default defineModule({
  key: 'moderation',
  name: 'Moderation',
  description: 'Cases, warnings, timeouts, kicks and bans.',
  group: 'order',
  pole: 'south',
  voteLocked: false,
  defaultEnabled: true,
  toggleable: true,
  config: moderationConfig,
  migrations: [
    {
      id: '1-cases',
      up: `
        create table moderation_counters (
          guild_id bigint primary key,
          last_number integer not null
        );

        create table moderation_cases (
          guild_id bigint not null,
          number integer not null,
          action text not null,
          user_id bigint,
          moderator_id bigint,
          reason text,
          duration_seconds integer,
          expires_at timestamptz,
          ended_at timestamptz,
          voided_at timestamptz,
          voided_by bigint,
          void_reason text,
          evidence text[] not null default '{}',
          excerpt text,
          meta jsonb not null default '{}',
          log_channel_id bigint,
          log_message_id bigint,
          edited_by bigint,
          edited_at timestamptz,
          created_at timestamptz not null default now(),
          primary key (guild_id, number)
        );

        create index moderation_cases_user on moderation_cases (guild_id, user_id, created_at desc);
        create index moderation_cases_created on moderation_cases (guild_id, created_at desc);
        create index moderation_cases_expiring on moderation_cases (expires_at)
          where expires_at is not null and ended_at is null and voided_at is null;
      `,
    },
    {
      id: '2-notes',
      up: `
        create table moderation_notes (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          user_id bigint not null,
          author_id bigint,
          body text not null,
          created_at timestamptz not null default now(),
          deleted_at timestamptz
        );

        create index moderation_notes_user on moderation_notes (guild_id, user_id, created_at desc);
      `,
    },
    {
      id: '3-names',
      up: `
        create table moderation_names (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          user_id bigint not null,
          kind text not null,
          value text,
          previous text,
          baseline boolean not null default false,
          changed_at timestamptz not null default now()
        );

        create index moderation_names_user on moderation_names (guild_id, user_id, kind, changed_at desc);
      `,
    },
    {
      id: '4-locks',
      up: `
        create table moderation_locks (
          guild_id bigint not null,
          channel_id bigint not null,
          changes jsonb not null,
          moderator_id bigint,
          reason text,
          ends_at timestamptz,
          created_at timestamptz not null default now(),
          primary key (guild_id, channel_id)
        );
      `,
    },
    {
      id: '5-note-numbers',
      up: `
        alter table moderation_notes add column number integer;
        update moderation_notes n set number = ranked.n
        from (
          select id, row_number() over (partition by guild_id order by id) as n from moderation_notes
        ) ranked
        where ranked.id = n.id;
        alter table moderation_notes alter column number set not null;
        create unique index moderation_notes_number on moderation_notes (guild_id, number);
      `,
    },
    {
      id: '6-inbox',
      up: `
        create table moderation_inbox (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          number integer not null,
          kind text not null check (kind in ('report', 'appeal', 'review')),
          status text not null default 'open'
            check (status in ('open', 'claimed', 'resolved', 'dismissed')),
          subject_id bigint,
          reporters bigint[] not null default '{}',
          channel_id bigint,
          message_id bigint,
          excerpt text,
          body text,
          case_number integer,
          assignee_id bigint,
          outcome text,
          outcome_case integer,
          note text,
          resolved_by bigint,
          resolved_at timestamptz,
          notice_channel_id bigint,
          notice_message_id bigint,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        create unique index moderation_inbox_number on moderation_inbox (guild_id, number);
        create index moderation_inbox_guild on moderation_inbox (guild_id, status, created_at desc);
        create index moderation_inbox_subject on moderation_inbox (guild_id, subject_id);
        create unique index moderation_inbox_review on moderation_inbox (guild_id, case_number)
          where kind = 'review';
      `,
    },
    {
      id: '7-inbox-sources',
      up: `
        alter table moderation_inbox drop constraint moderation_inbox_kind_check;
        alter table moderation_inbox add constraint moderation_inbox_kind_check
          check (kind in ('report', 'appeal', 'review', 'gate', 'check'));
        alter table moderation_inbox add column ref_id bigint;
        create unique index moderation_inbox_gate on moderation_inbox (guild_id)
          where kind = 'gate' and status in ('open', 'claimed');
        create unique index moderation_inbox_check on moderation_inbox (guild_id, ref_id)
          where kind = 'check';
      `,
    },
  ],
});
