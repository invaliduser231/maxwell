import { z } from 'zod';
import { defineModule } from './types.js';

const snowflake = z.string().regex(/^\d{1,21}$/);
const itemId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);

const itemBase = {
  id: itemId,
  name: z.string().trim().min(1).max(64),
  description: z.string().max(200).default(''),
  price: z.number().int().min(0).max(1_000_000_000),
  stock: z.number().int().min(0).nullable().default(null),
  perUser: z.number().int().min(1).nullable().default(null),
  enabled: z.boolean().default(true),
};

export const shopItem = z.discriminatedUnion('kind', [
  z.object({
    ...itemBase,
    kind: z.literal('role'),
    roleId: snowflake,
    durationHours: z.number().int().min(1).max(8760).nullable().default(null),
  }),
  z.object({ ...itemBase, kind: z.literal('pack'), packId: itemId }),
  z.object({ ...itemBase, kind: z.literal('background'), assetKey: z.string().min(1).max(128) }),
  z.object({
    ...itemBase,
    kind: z.literal('giveaway'),
    giveawayId: z.string().nullable().default(null),
  }),
]);

export type ShopItem = z.infer<typeof shopItem>;
export type ShopKind = ShopItem['kind'];

export const economyConfig = z.object({
  currency: z
    .object({
      name: z.string().trim().min(1).max(32).default('Joules'),
      singular: z.string().trim().min(1).max(32).default('Joule'),
      symbol: z.string().trim().min(1).max(64).default('J'),
    })
    .prefault({}),
  message: z
    .object({
      enabled: z.boolean().default(true),
      min: z.number().int().min(0).max(10_000).default(1),
      max: z.number().int().min(0).max(10_000).default(5),
      cooldownSeconds: z.number().int().min(0).max(86_400).default(60),
      ignoredChannels: z.array(snowflake).default([]),
    })
    .prefault({}),
  daily: z
    .object({
      enabled: z.boolean().default(true),
      amount: z.number().int().min(0).max(1_000_000).default(100),
      streakBonus: z.number().int().min(0).max(1_000_000).default(10),
      streakCap: z.number().int().min(1).max(365).default(7),
    })
    .prefault({}),
  rewards: z
    .object({
      event: z.number().int().min(0).max(1_000_000).default(50),
      gameWin: z.number().int().min(0).max(1_000_000).default(20),
    })
    .prefault({}),
  dailyCap: z.number().int().min(0).max(100_000_000).nullable().default(500),
  transferTax: z.number().min(0).max(50).default(5),
  startingBalance: z.number().int().min(0).max(1_000_000).default(0),
  shop: z.array(shopItem).max(50).default([]),
});

export type EconomyConfig = z.infer<typeof economyConfig>;

export default defineModule({
  key: 'economy',
  name: 'Economy',
  description: 'Joules, the shop and daily rewards.',
  group: 'play',
  pole: 'north',
  voteLocked: true,
  defaultEnabled: false,
  toggleable: true,
  config: economyConfig,
  migrations: [
    {
      id: '1-wallets',
      up: `
        create table economy_wallets (
          guild_id bigint not null,
          user_id bigint not null,
          balance bigint not null default 0 check (balance >= 0),
          earned_day date,
          earned_today bigint not null default 0,
          daily_at timestamptz,
          daily_streak integer not null default 0,
          background text,
          updated_at timestamptz not null default now(),
          primary key (guild_id, user_id)
        );

        create index economy_wallets_rich on economy_wallets (guild_id, balance desc);

        create table economy_transactions (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          user_id bigint not null,
          amount bigint not null,
          balance bigint not null,
          kind text not null,
          note text,
          ref text,
          counterpart_id bigint,
          created_at timestamptz not null default now()
        );

        create index economy_transactions_user on economy_transactions (guild_id, user_id, id desc);
        create index economy_transactions_guild on economy_transactions (guild_id, id desc);

        create table economy_supply (
          guild_id bigint not null,
          day date not null,
          minted bigint not null default 0,
          burned bigint not null default 0,
          primary key (guild_id, day)
        );
      `,
    },
    {
      id: '2-shop',
      up: `
        create table economy_stock (
          guild_id bigint not null,
          item_id text not null,
          sold integer not null default 0,
          primary key (guild_id, item_id)
        );

        create table economy_purchases (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          user_id bigint not null,
          item_id text not null,
          kind text not null,
          price bigint not null,
          ref text,
          created_at timestamptz not null default now(),
          refunded_at timestamptz
        );

        create index economy_purchases_user on economy_purchases (guild_id, user_id, item_id);
        create index economy_purchases_guild on economy_purchases (guild_id, id desc);

        create table economy_inventory (
          guild_id bigint not null,
          user_id bigint not null,
          kind text not null,
          ref text not null,
          quantity integer not null default 0 check (quantity >= 0),
          primary key (guild_id, user_id, kind, ref)
        );
      `,
    },
    {
      id: '3-resets',
      up: `
        create table economy_resets (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          members integer not null default 0,
          total bigint not null default 0,
          created_at timestamptz not null default now(),
          restored_at timestamptz
        );

        create index economy_resets_guild on economy_resets (guild_id, id desc);

        create table economy_reset_balances (
          reset_id bigint not null references economy_resets (id) on delete cascade,
          guild_id bigint not null,
          user_id bigint not null,
          balance bigint not null check (balance > 0),
          primary key (reset_id, user_id)
        );

        create index economy_reset_balances_user on economy_reset_balances (guild_id, user_id);
      `,
    },
  ],
});
