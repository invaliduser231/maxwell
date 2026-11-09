import { z } from 'zod';
import { defineModule } from './types.js';

const slug = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9-]+$/);

export const ticketPanelKinds = ['support', 'report', 'appeal', 'custom'] as const;

export const ticketPanel = z.object({
  id: slug,
  kind: z.enum(ticketPanelKinds).default('support'),
  name: z.string().min(1).max(80).default('Support'),
  channelId: z.string().nullable().default(null),
  categoryId: z.string().nullable().default(null),
  teamRoleIds: z.array(z.string()).max(10).default([]),
  pingTeam: z.boolean().default(true),
  emoji: z.string().max(80).default(''),
  title: z.string().max(256).default(''),
  description: z.string().max(2000).default(''),
  openMessage: z.string().max(2000).default(''),
  channelName: z.string().min(1).max(90).default('{panel}-{number}'),
  maxOpenPerMember: z.number().int().min(1).max(10).default(1),
  verifyRoleId: z.string().nullable().default(null),
});

export const ticketCannedReply = z.object({
  name: slug,
  content: z.string().min(1).max(2000),
});

export const ticketModmail = z.object({
  enabled: z.boolean().default(false),
  categoryId: z.string().nullable().default(null),
  teamRoleIds: z.array(z.string()).max(10).default([]),
  pingTeam: z.boolean().default(true),
  openMessage: z.string().max(2000).default(''),
  anonymous: z.boolean().default(false),
  internalMarker: z.string().min(1).max(5).default('//'),
});

export const ticketsConfig = z.object({
  panels: z.array(ticketPanel).max(10).default([]),
  logChannelId: z.string().nullable().default(null),
  transcripts: z.boolean().default(true),
  webForm: z.boolean().default(false),
  openerCanClose: z.boolean().default(true),
  closeDelaySeconds: z.number().int().min(0).max(3600).default(10),
  deleteOnClose: z.boolean().default(true),
  autoCloseHours: z.number().int().min(0).max(720).default(0),
  ratingEnabled: z.boolean().default(true),
  cannedPrefix: z.string().min(1).max(3).default('$'),
  cannedReplies: z.array(ticketCannedReply).max(50).default([]),
  modmail: ticketModmail.prefault({}),
});

export type TicketsConfig = z.output<typeof ticketsConfig>;
export type TicketPanel = z.output<typeof ticketPanel>;
export type TicketModmail = z.output<typeof ticketModmail>;
export type TicketPanelKind = (typeof ticketPanelKinds)[number];

export default defineModule({
  key: 'tickets',
  name: 'Tickets',
  description: 'Support tickets and modmail.',
  group: 'community',
  pole: 'north',
  voteLocked: false,
  defaultEnabled: false,
  toggleable: true,
  config: ticketsConfig,
  migrations: [
    {
      id: '1-tickets',
      up: `
        create table tickets_tickets (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          number integer not null,
          panel_id text not null,
          kind text not null,
          source text not null,
          channel_id bigint,
          channel_name text,
          opener_id bigint not null,
          subject text,
          members bigint[] not null default '{}',
          claimed_by bigint,
          status text not null default 'open',
          control_message_id bigint,
          message_count integer not null default 0,
          created_at timestamptz not null default now(),
          first_response_at timestamptz,
          last_message_at timestamptz not null default now(),
          closed_at timestamptz,
          closed_by bigint,
          close_reason text,
          rating smallint,
          rating_requested_at timestamptz,
          rated_at timestamptz,
          rating_channel_id bigint,
          rating_message_id bigint,
          unique (guild_id, number)
        );

        create index tickets_tickets_channel on tickets_tickets (channel_id) where channel_id is not null;
        create index tickets_tickets_guild on tickets_tickets (guild_id, status, created_at desc);
        create index tickets_tickets_opener on tickets_tickets (opener_id, status);
        create index tickets_tickets_rating on tickets_tickets (rating_message_id) where rating_message_id is not null;

        create table tickets_counters (
          guild_id bigint primary key,
          last integer not null
        );
      `,
    },
    {
      id: '2-messages',
      up: `
        create table tickets_messages (
          ticket_id bigint not null references tickets_tickets (id) on delete cascade,
          message_id bigint not null,
          author_id bigint not null,
          author_name text not null,
          author_avatar text,
          bot boolean not null default false,
          via text,
          content text not null default '',
          attachments jsonb not null default '[]',
          created_at timestamptz not null,
          edited_at timestamptz,
          deleted_at timestamptz,
          primary key (ticket_id, message_id)
        );
      `,
    },
    {
      id: '3-panels',
      up: `
        create table tickets_panels (
          guild_id bigint not null,
          panel_id text not null,
          channel_id bigint not null,
          message_id bigint not null unique,
          emoji text not null,
          published_at timestamptz not null default now(),
          primary key (guild_id, panel_id)
        );

        create table tickets_dm_channels (
          user_id bigint primary key,
          channel_id bigint not null,
          seen_at timestamptz not null default now()
        );
      `,
    },
    {
      id: '4-embeds',
      up: `
        alter table tickets_messages add column embeds jsonb not null default '[]';
        create index tickets_messages_author on tickets_messages (author_id);
      `,
    },
    {
      id: '5-modmail-targets',
      up: `
        create table tickets_modmail_targets (
          user_id bigint not null,
          guild_id bigint not null,
          used_at timestamptz not null default now(),
          pinned_until timestamptz,
          primary key (user_id, guild_id)
        );
      `,
    },
  ],
});
