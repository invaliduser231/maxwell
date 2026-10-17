import { z } from 'zod';
import { defineModule } from './types.js';

const snowflake = z.string().regex(/^\d{1,21}$/);
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const COMMUNITY_DECK = 'community';

export const rarityTier = z.object({
  id: slug,
  name: z.string().trim().min(1).max(32),
  weight: z.number().positive().max(1_000_000),
  color: hex,
});

export type RarityTier = z.infer<typeof rarityTier>;

export const defaultTiers: RarityTier[] = [
  { id: 'common', name: 'Common', weight: 60, color: '#8A8F98' },
  { id: 'uncommon', name: 'Uncommon', weight: 25, color: '#2EB67D' },
  { id: 'rare', name: 'Rare', weight: 10, color: '#3A9EEA' },
  { id: 'epic', name: 'Epic', weight: 4, color: '#F2C14E' },
  { id: 'legendary', name: 'Legendary', weight: 1, color: '#F26B3A' },
];

export const cardPack = z.object({
  id: slug,
  name: z.string().trim().min(1).max(64),
  price: z.number().int().min(0).max(1_000_000_000),
  size: z.number().int().min(1).max(10).default(3),
  guaranteed: slug.nullable().default(null),
  deckId: slug.nullable().default(null),
  enabled: z.boolean().default(true),
});

export type CardPack = z.infer<typeof cardPack>;

export const cardSet = z.object({
  id: slug,
  name: z.string().trim().min(1).max(64),
  deckId: slug.nullable().default(null),
  cardIds: z
    .array(z.string().regex(/^\d{1,18}$/))
    .max(100)
    .default([]),
  rewardAmount: z.number().int().min(0).max(1_000_000_000).default(0),
  rewardRoleId: snowflake.nullable().default(null),
});

export type CardSet = z.infer<typeof cardSet>;

export const collectionConfig = z.object({
  tiers: z.array(rarityTier).min(1).max(10).default(defaultTiers),
  community: z
    .object({
      enabled: z.boolean().default(true),
      activityDays: z.number().int().min(1).max(365).default(30),
    })
    .prefault({}),
  decks: z
    .array(
      z.object({
        id: slug,
        name: z.string().trim().min(1).max(64),
        enabled: z.boolean().default(true),
      }),
    )
    .max(25)
    .default([]),
  drops: z
    .object({
      enabled: z.boolean().default(false),
      channelIds: z.array(snowflake).max(25).default([]),
      everyMessages: z.number().int().min(5).max(10_000).default(50),
      minMinutes: z.number().int().min(1).max(1_440).default(15),
      claimMinutes: z.number().int().min(1).max(120).default(10),
    })
    .prefault({}),
  packs: z
    .array(cardPack)
    .max(20)
    .default([
      {
        id: 'standard',
        name: 'Standard pack',
        price: 250,
        size: 3,
        guaranteed: null,
        deckId: null,
        enabled: true,
      },
    ]),
  sets: z.array(cardSet).max(50).default([]),
  trading: z
    .object({
      enabled: z.boolean().default(true),
      maxCards: z.number().int().min(1).max(10).default(5),
      expiryMinutes: z.number().int().min(1).max(60).default(10),
    })
    .prefault({}),
});

export type CollectionConfig = z.infer<typeof collectionConfig>;

export default defineModule({
  key: 'collection',
  name: 'Collection',
  description: 'Collect your community.',
  group: 'play',
  pole: 'north',
  voteLocked: true,
  defaultEnabled: false,
  toggleable: true,
  config: collectionConfig,
  migrations: [
    {
      id: '1-cards',
      up: `
        create table collection_cards (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          deck text not null,
          member_id bigint,
          name text not null,
          description text not null default '',
          rarity text not null,
          asset_key text,
          active boolean not null default true,
          created_at timestamptz not null default now()
        );

        create index collection_cards_guild on collection_cards (guild_id, deck) where active;
        create unique index collection_cards_member on collection_cards (guild_id, member_id)
          where member_id is not null;

        create table collection_owned (
          guild_id bigint not null,
          user_id bigint not null,
          card_id bigint not null references collection_cards (id) on delete cascade,
          count integer not null default 1 check (count >= 0),
          first_at timestamptz not null default now(),
          primary key (guild_id, user_id, card_id)
        );

        create index collection_owned_card on collection_owned (card_id);

        create table collection_activity (
          guild_id bigint not null,
          user_id bigint not null,
          day date not null,
          messages integer not null default 0,
          primary key (guild_id, user_id, day)
        );

        create table collection_wishlist (
          guild_id bigint not null,
          user_id bigint not null,
          card_id bigint not null references collection_cards (id) on delete cascade,
          created_at timestamptz not null default now(),
          primary key (guild_id, user_id, card_id)
        );

        create index collection_wishlist_card on collection_wishlist (card_id);

        create table collection_set_rewards (
          guild_id bigint not null,
          user_id bigint not null,
          set_id text not null,
          rewarded_at timestamptz not null default now(),
          primary key (guild_id, user_id, set_id)
        );
      `,
    },
    {
      id: '2-drops-trades',
      up: `
        create table collection_drops (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          channel_id bigint not null,
          message_id bigint,
          card_id bigint not null references collection_cards (id) on delete cascade,
          created_at timestamptz not null default now(),
          expires_at timestamptz not null,
          claimed_by bigint,
          claimed_at timestamptz
        );

        create index collection_drops_open on collection_drops (guild_id, channel_id, id desc)
          where claimed_by is null;

        create table collection_trades (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          channel_id bigint not null,
          message_id bigint,
          from_user bigint not null,
          to_user bigint not null,
          give bigint[] not null default '{}',
          want bigint[] not null default '{}',
          from_ok boolean not null default false,
          to_ok boolean not null default false,
          status text not null default 'open',
          created_at timestamptz not null default now(),
          expires_at timestamptz not null
        );

        create index collection_trades_message on collection_trades (message_id) where status = 'open';
      `,
    },
    {
      id: '3-numbers',
      up: `
        alter table collection_cards add column number integer;
        update collection_cards c set number = ranked.n
        from (
          select id, row_number() over (partition by guild_id order by id) as n from collection_cards
        ) ranked
        where ranked.id = c.id;
        alter table collection_cards alter column number set not null;
        create unique index collection_cards_number on collection_cards (guild_id, number);
      `,
    },
  ],
});
