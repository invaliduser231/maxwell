import { z } from 'zod';
import { defineModule } from './types.js';

export const bonusEntry = z.object({
  roleId: z.string().min(1),
  entries: z.number().int().min(1).max(50),
});

export type BonusEntry = z.infer<typeof bonusEntry>;

export const giveawaysConfig = z.object({
  emoji: z.string().min(1).max(100).nullable().default(null),
  pingRoleId: z.string().nullable().default(null),
  dmWinners: z.boolean().default(true),
  requiredRoleId: z.string().nullable().default(null),
  excludedRoleId: z.string().nullable().default(null),
  minLevel: z.number().int().min(0).max(1000).default(0),
  minMemberDays: z.number().int().min(0).max(3650).default(0),
  bonusEntries: z.array(bonusEntry).max(25).default([]),
});

export type GiveawaysConfig = z.infer<typeof giveawaysConfig>;

export const giveawayStatuses = ['scheduled', 'running', 'ended', 'cancelled'] as const;

export type GiveawayStatus = (typeof giveawayStatuses)[number];

export default defineModule({
  key: 'giveaways',
  name: 'Giveaways',
  description: 'Giveaways with requirements and bonus entries.',
  group: 'community',
  pole: 'north',
  voteLocked: false,
  defaultEnabled: false,
  toggleable: true,
  config: giveawaysConfig,
  migrations: [
    {
      id: '1-giveaways',
      up: `
        create table giveaways_items (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          channel_id bigint not null,
          message_id bigint unique,
          host_id bigint,
          prize text not null,
          winners integer not null check (winners between 1 and 50),
          emoji text not null,
          status text not null default 'scheduled'
            check (status in ('scheduled', 'running', 'ended', 'cancelled')),
          starts_at timestamptz not null default now(),
          ends_at timestamptz not null,
          ended_at timestamptz,
          required_role_id bigint,
          min_level integer not null default 0,
          min_member_days integer not null default 0,
          bonus jsonb not null default '[]',
          created_at timestamptz not null default now()
        );

        create index giveaways_items_guild on giveaways_items (guild_id, status, ends_at);

        create table giveaways_entries (
          giveaway_id bigint not null references giveaways_items (id) on delete cascade,
          user_id bigint not null,
          weight integer not null default 1 check (weight >= 1),
          entered_at timestamptz not null default now(),
          primary key (giveaway_id, user_id)
        );

        create table giveaways_winners (
          giveaway_id bigint not null references giveaways_items (id) on delete cascade,
          user_id bigint not null,
          round integer not null default 1,
          drawn_at timestamptz not null default now(),
          primary key (giveaway_id, user_id)
        );
      `,
    },
    {
      id: '2-numbers',
      up: `
        alter table giveaways_items add column number integer;
        update giveaways_items g set number = ranked.n
        from (
          select id, row_number() over (partition by guild_id order by id) as n from giveaways_items
        ) ranked
        where ranked.id = g.id;
        alter table giveaways_items alter column number set not null;
        create unique index giveaways_items_number on giveaways_items (guild_id, number);
      `,
    },
    {
      id: '3-options',
      up: `
        alter table giveaways_items
          add column description text,
          add column excluded_role_id bigint,
          add column ping_role_id bigint,
          add column dm_winners boolean not null default true;
      `,
    },
  ],
});
