import type postgres from 'postgres';
import type { Sql } from '../db/sql.js';
import { COMMUNITY_DECK } from '../modules/collection.js';

type Db = Sql | postgres.TransactionSql;

export interface Card {
  id: string;
  number: number;
  guildId: string;
  deck: string;
  memberId: string | null;
  name: string;
  description: string;
  rarity: string;
  assetKey: string | null;
  active: boolean;
  createdAt: Date;
}

export interface OwnedCard extends Card {
  count: number;
  firstAt: Date;
}

export interface PoolCard {
  id: string;
  deck: string;
  rarity: string;
}

export interface DeckCard extends Card {
  owners: number;
}

export interface CollectionOverview {
  claimed: number;
  collectors: number;
  claimedWeek: number;
  tradesWeek: number;
  members: number;
  sets: Record<string, number>;
}

export interface CardInput {
  deck: string;
  name: string;
  description?: string;
  rarity: string;
  assetKey?: string | null;
}

export interface Drop {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  cardId: string;
  createdAt: Date;
  expiresAt: Date;
  claimedBy: string | null;
  claimedAt: Date | null;
}

export type TradeStatus = 'open' | 'done' | 'cancelled' | 'expired' | 'failed';

export interface Trade {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  fromUser: string;
  toUser: string;
  give: string[];
  want: string[];
  fromOk: boolean;
  toOk: boolean;
  status: TradeStatus;
  createdAt: Date;
  expiresAt: Date;
}

export interface ActivityRow {
  memberId: string;
  cardId: string;
  rarity: string;
  messages: number;
}

export type MemberData = {
  card: {
    id: string;
    number: number;
    name: string;
    rarity: string;
    active: boolean;
    createdAt: Date;
  } | null;
  owned: {
    cardId: string;
    number: number;
    name: string;
    deck: string;
    count: number;
    firstAt: Date;
  }[];
  wishlist: { cardId: string; number: number; name: string; createdAt: Date }[];
  sets: { setId: string; rewardedAt: Date }[];
  activity: { day: string; messages: number }[];
  drops: { cardId: string; number: number | null; claimedAt: Date | null }[];
  trades: {
    status: TradeStatus;
    proposed: boolean;
    otherId: string;
    gave: string[];
    got: string[];
    gaveNumbers: number[];
    gotNumbers: number[];
    createdAt: Date;
  }[];
};

class Missing extends Error {}

const cardColumns = (sql: Db) => sql`
  c.id::text as id, c.number, c.guild_id::text as "guildId", c.deck, c.member_id::text as "memberId", c.name,
  c.description, c.rarity, c.asset_key as "assetKey", c.active, c.created_at as "createdAt"
`;

const dropColumns = (sql: Db) => sql`
  id::text as id, guild_id::text as "guildId", channel_id::text as "channelId",
  message_id::text as "messageId", card_id::text as "cardId", created_at as "createdAt",
  expires_at as "expiresAt", claimed_by::text as "claimedBy", claimed_at as "claimedAt"
`;

const tradeColumns = (sql: Db) => sql`
  id::text as id, guild_id::text as "guildId", channel_id::text as "channelId",
  message_id::text as "messageId", from_user::text as "fromUser", to_user::text as "toUser",
  give::text[] as give, want::text[] as want, from_ok as "fromOk", to_ok as "toOk", status,
  created_at as "createdAt", expires_at as "expiresAt"
`;

function validNumber(number: number): boolean {
  return Number.isSafeInteger(number) && number >= 1 && number <= 2_147_483_647;
}

export function tally(ids: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

export class CollectionStore {
  constructor(private readonly sql: Sql) {}

  async cards(
    guildId: string,
    options: { deck?: string; activeOnly?: boolean; limit?: number; offset?: number } = {},
  ): Promise<Card[]> {
    const limit = Math.min(Math.max(options.limit ?? 500, 1), 5_000);
    return this.sql<Card[]>`
      select ${cardColumns(this.sql)} from collection_cards c
      where guild_id = ${guildId}
        ${options.deck ? this.sql`and deck = ${options.deck}` : this.sql``}
        ${options.activeOnly ? this.sql`and active` : this.sql``}
      order by id
      limit ${limit} offset ${Math.max(options.offset ?? 0, 0)}
    `;
  }

  async card(guildId: string, cardId: string): Promise<Card | null> {
    if (!/^\d{1,18}$/.test(cardId)) return null;
    const [row] = await this.sql<Card[]>`
      select ${cardColumns(this.sql)} from collection_cards c where guild_id = ${guildId} and id = ${cardId}
    `;
    return row ?? null;
  }

  async cardByNumber(guildId: string, number: number): Promise<Card | null> {
    if (!validNumber(number)) return null;
    const [row] = await this.sql<Card[]>`
      select ${cardColumns(this.sql)} from collection_cards c
      where guild_id = ${guildId} and number = ${number}
    `;
    return row ?? null;
  }

  async cardsByNumbers(guildId: string, numbers: readonly number[]): Promise<Map<number, Card>> {
    const valid = [...new Set(numbers)].filter(validNumber);
    if (valid.length === 0) return new Map();
    const rows = await this.sql<Card[]>`
      select ${cardColumns(this.sql)} from collection_cards c
      where guild_id = ${guildId} and number = any(${valid}::int[])
    `;
    return new Map(rows.map((row) => [row.number, row]));
  }

  async cardsByIds(guildId: string, ids: readonly string[]): Promise<Map<string, Card>> {
    const valid = [...new Set(ids)].filter((id) => /^\d{1,18}$/.test(id));
    if (valid.length === 0) return new Map();
    const rows = await this.sql<Card[]>`
      select ${cardColumns(this.sql)} from collection_cards c
      where guild_id = ${guildId} and id = any(${valid}::bigint[])
    `;
    return new Map(rows.map((row) => [row.id, row]));
  }

  async findCards(guildId: string, query: string, limit = 5): Promise<Card[]> {
    const text = query.trim();
    if (!text) return [];
    const pattern = `${text.replace(/[\\%_]/g, '\\$&')}%`;
    return this.sql<Card[]>`
      select ${cardColumns(this.sql)} from collection_cards c
      where guild_id = ${guildId} and active and name ilike ${pattern}
      order by lower(name) = lower(${text}) desc, length(name), id
      limit ${limit}
    `;
  }

  async createCard(guildId: string, input: CardInput): Promise<Card> {
    return this.sql.begin(async (tx) => {
      await this.#lock(tx, guildId);
      const [row] = await tx<Card[]>`
        insert into collection_cards as c (
          guild_id, number, deck, name, description, rarity, asset_key
        )
        values (${guildId}, ${this.#next(tx, guildId)}, ${input.deck}, ${input.name},
          ${input.description ?? ''}, ${input.rarity}, ${input.assetKey ?? null})
        returning ${cardColumns(tx)}
      `;
      if (!row) throw new Error('card insert returned nothing');
      return row;
    });
  }

  async updateCard(
    guildId: string,
    cardId: string,
    patch: Partial<Pick<Card, 'name' | 'description' | 'rarity' | 'assetKey' | 'active'>>,
  ): Promise<Card | null> {
    const current = await this.card(guildId, cardId);
    if (!current) return null;
    const next = { ...current, ...patch };
    const [row] = await this.sql<Card[]>`
      update collection_cards c set name = ${next.name}, description = ${next.description},
        rarity = ${next.rarity}, asset_key = ${next.assetKey}, active = ${next.active}
      where c.guild_id = ${guildId} and c.id = ${cardId}
      returning ${cardColumns(this.sql)}
    `;
    return row ?? null;
  }

  async deleteCard(guildId: string, cardId: string): Promise<boolean> {
    const rows = await this
      .sql`delete from collection_cards where guild_id = ${guildId} and id = ${cardId} returning id`;
    return rows.length > 0;
  }

  async memberCard(guildId: string, memberId: string): Promise<Card | null> {
    const [row] = await this.sql<Card[]>`
      select ${cardColumns(this.sql)} from collection_cards c
      where guild_id = ${guildId} and member_id = ${memberId}
    `;
    return row ?? null;
  }

  async optIn(
    guildId: string,
    memberId: string,
    name: string,
    rarity: string,
  ): Promise<{ card: Card; created: boolean }> {
    const existing = await this.memberCard(guildId, memberId);
    if (existing) {
      const card =
        (await this.updateCard(guildId, existing.id, { name, active: true })) ?? existing;
      return { card, created: false };
    }
    const row = await this.sql.begin(async (tx) => {
      await this.#lock(tx, guildId);
      const [inserted] = await tx<Card[]>`
        insert into collection_cards as c (guild_id, number, deck, member_id, name, rarity)
        values (${guildId}, ${this.#next(tx, guildId)}, ${COMMUNITY_DECK}, ${memberId}, ${name},
          ${rarity})
        on conflict (guild_id, member_id) where member_id is not null
          do update set active = true, name = excluded.name
        returning ${cardColumns(tx)}
      `;
      return inserted;
    });
    if (!row) throw new Error('member card insert returned nothing');
    return { card: row, created: true };
  }

  async optOut(guildId: string, memberId: string): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        delete from collection_cards where guild_id = ${guildId} and member_id = ${memberId}
        returning id
      `;
      await tx`delete from collection_activity where guild_id = ${guildId} and user_id = ${memberId}`;
      return rows.length > 0;
    });
  }

  async optedIn(guildId: string): Promise<string[]> {
    const rows = await this.sql<{ memberId: string }[]>`
      select member_id::text as "memberId" from collection_cards
      where guild_id = ${guildId} and member_id is not null and active
    `;
    return rows.map((row) => row.memberId);
  }

  async pool(guildId: string, decks: readonly string[]): Promise<PoolCard[]> {
    if (decks.length === 0) return [];
    return this.sql<PoolCard[]>`
      select id::text as id, deck, rarity from collection_cards
      where guild_id = ${guildId} and active and deck = any(${[...decks]}::text[])
    `;
  }

  async grant(guildId: string, userId: string, cardIds: readonly string[]): Promise<Set<string>> {
    const counts = tally(cardIds);
    if (counts.size === 0) return new Set();
    return this.sql.begin(async (tx) => {
      const fresh = new Set<string>();
      for (const [cardId, count] of counts) {
        const [row] = await tx<{ count: number }[]>`
          insert into collection_owned (guild_id, user_id, card_id, count)
          values (${guildId}, ${userId}, ${cardId}, ${count})
          on conflict (guild_id, user_id, card_id) do update
            set count = collection_owned.count + excluded.count
          returning count
        `;
        if (row?.count === count) fresh.add(cardId);
      }
      return fresh;
    });
  }

  async revoke(guildId: string, userId: string, cardId: string, count = 1): Promise<number> {
    return this.sql.begin(async (tx) => {
      const [row] = await tx<{ count: number }[]>`
        select count from collection_owned
        where guild_id = ${guildId} and user_id = ${userId} and card_id = ${cardId}
        for update
      `;
      const taken = Math.min(row?.count ?? 0, Math.max(count, 0));
      if (taken === 0) return 0;
      await this.#take(tx, guildId, userId, cardId, taken);
      return taken;
    });
  }

  async owned(
    guildId: string,
    userId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<OwnedCard[]> {
    const limit = Math.min(Math.max(options.limit ?? 500, 1), 5_000);
    return this.sql<OwnedCard[]>`
      select ${cardColumns(this.sql)}, o.count, o.first_at as "firstAt"
      from collection_owned o join collection_cards c on c.id = o.card_id
      where o.guild_id = ${guildId} and o.user_id = ${userId} and o.count > 0
      order by c.deck, c.name, c.id
      limit ${limit} offset ${Math.max(options.offset ?? 0, 0)}
    `;
  }

  async ownedCounts(
    guildId: string,
    userId: string,
    cardIds: readonly string[],
  ): Promise<Map<string, number>> {
    const valid = [...new Set(cardIds)].filter((id) => /^\d{1,18}$/.test(id));
    if (valid.length === 0) return new Map();
    const rows = await this.sql<{ cardId: string; count: number }[]>`
      select card_id::text as "cardId", count from collection_owned
      where guild_id = ${guildId} and user_id = ${userId} and card_id = any(${valid}::bigint[])
        and count > 0
    `;
    return new Map(rows.map((row) => [row.cardId, row.count]));
  }

  async ownedIds(guildId: string, userId: string): Promise<Set<string>> {
    const rows = await this.sql<{ cardId: string }[]>`
      select card_id::text as "cardId" from collection_owned
      where guild_id = ${guildId} and user_id = ${userId} and count > 0
    `;
    return new Set(rows.map((row) => row.cardId));
  }

  async summary(guildId: string, userId: string): Promise<{ total: number; unique: number }> {
    const [row] = await this.sql<{ total: number; unique: number }[]>`
      select coalesce(sum(count), 0)::int as total, count(*)::int as unique
      from collection_owned where guild_id = ${guildId} and user_id = ${userId} and count > 0
    `;
    return row ?? { total: 0, unique: 0 };
  }

  async owners(guildId: string, cardId: string): Promise<number> {
    const [row] = await this.sql<{ owners: number }[]>`
      select count(*)::int as owners from collection_owned
      where guild_id = ${guildId} and card_id = ${cardId} and count > 0
    `;
    return row?.owners ?? 0;
  }

  async addActivity(
    guildId: string,
    counts: ReadonlyMap<string, number>,
    day: string,
  ): Promise<void> {
    if (counts.size === 0) return;
    const users = [...counts.keys()];
    const values = users.map((user) => counts.get(user) ?? 0);
    await this.sql`
      insert into collection_activity (guild_id, user_id, day, messages)
      select ${guildId}, u, ${day}::date, m
      from unnest(${users}::bigint[], ${values}::int[]) as t(u, m)
      on conflict (guild_id, user_id, day) do update
        set messages = collection_activity.messages + excluded.messages
    `;
  }

  async activity(guildId: string, days: number): Promise<ActivityRow[]> {
    return this.sql<ActivityRow[]>`
      select c.member_id::text as "memberId", c.id::text as "cardId", c.rarity,
        coalesce(sum(a.messages), 0)::int as messages
      from collection_cards c
      left join collection_activity a
        on a.guild_id = c.guild_id and a.user_id = c.member_id
        and a.day > (now() at time zone 'utc')::date - ${Math.max(days, 1)}::int
      where c.guild_id = ${guildId} and c.member_id is not null and c.active
      group by c.id
      order by messages desc, c.id
    `;
  }

  async setRarities(
    guildId: string,
    updates: readonly { cardId: string; rarity: string }[],
  ): Promise<void> {
    if (updates.length === 0) return;
    await this.sql`
      update collection_cards c set rarity = t.rarity
      from unnest(${updates.map((u) => u.cardId)}::bigint[], ${updates.map((u) => u.rarity)}::text[])
        as t(id, rarity)
      where c.guild_id = ${guildId} and c.id = t.id
    `;
  }

  async pruneActivity(days: number): Promise<number> {
    const rows = await this.sql`
      delete from collection_activity
      where day < (now() at time zone 'utc')::date - ${Math.max(days, 1)}::int
      returning 1
    `;
    return rows.length;
  }

  async overview(guildId: string): Promise<CollectionOverview> {
    const [owned] = await this.sql<{ claimed: number; collectors: number; claimedWeek: number }[]>`
      select coalesce(sum(count), 0)::int as claimed, count(distinct user_id)::int as collectors,
        count(*) filter (where first_at > now() - interval '7 days')::int as "claimedWeek"
      from collection_owned where guild_id = ${guildId}
    `;
    const [trades] = await this.sql<{ trades: number }[]>`
      select count(*)::int as trades from collection_trades
      where guild_id = ${guildId} and status = 'done' and created_at > now() - interval '7 days'
    `;
    const sets = await this.sql<{ setId: string; done: number }[]>`
      select set_id as "setId", count(*)::int as done from collection_set_rewards
      where guild_id = ${guildId}
      group by set_id
    `;
    const [members] = await this.sql<{ members: number }[]>`
      select count(*)::int as members from collection_cards
      where guild_id = ${guildId} and member_id is not null and active
    `;
    return {
      claimed: owned?.claimed ?? 0,
      collectors: owned?.collectors ?? 0,
      claimedWeek: owned?.claimedWeek ?? 0,
      tradesWeek: trades?.trades ?? 0,
      members: members?.members ?? 0,
      sets: Object.fromEntries(sets.map((row) => [row.setId, row.done])),
    };
  }

  async customCards(guildId: string, limit = 2_000): Promise<DeckCard[]> {
    return this.sql<DeckCard[]>`
      select ${cardColumns(this.sql)},
        (select count(*)::int from collection_owned o where o.card_id = c.id) as owners
      from collection_cards c
      where c.guild_id = ${guildId} and c.member_id is null
      order by c.deck, c.id
      limit ${Math.min(Math.max(limit, 1), 5_000)}
    `;
  }

  async guildsWithMembers(): Promise<string[]> {
    const rows = await this.sql<{ guildId: string }[]>`
      select distinct guild_id::text as "guildId" from collection_cards where member_id is not null
    `;
    return rows.map((row) => row.guildId);
  }

  async asset(guildId: string, key: string): Promise<Buffer | null> {
    const [row] = await this.sql<{ data: Buffer }[]>`
      select data from guild_assets where guild_id = ${guildId} and key = ${key}
    `;
    return row?.data ?? null;
  }

  async createDrop(
    guildId: string,
    channelId: string,
    cardId: string,
    expiresAt: Date,
  ): Promise<Drop> {
    const [row] = await this.sql<Drop[]>`
      insert into collection_drops (guild_id, channel_id, card_id, expires_at)
      values (${guildId}, ${channelId}, ${cardId}, ${expiresAt})
      returning ${dropColumns(this.sql)}
    `;
    if (!row) throw new Error('drop insert returned nothing');
    return row;
  }

  async setDropMessage(dropId: string, messageId: string): Promise<void> {
    await this.sql`update collection_drops set message_id = ${messageId} where id = ${dropId}`;
  }

  async drop(dropId: string): Promise<Drop | null> {
    const [row] = await this.sql<Drop[]>`
      select ${dropColumns(this.sql)} from collection_drops where id = ${dropId}
    `;
    return row ?? null;
  }

  async claimDrop(guildId: string, channelId: string, userId: string): Promise<Drop | null> {
    return this.sql.begin(async (tx) => {
      const [row] = await tx<Drop[]>`
        update collection_drops set claimed_by = ${userId}, claimed_at = now()
        where id = (
          select id from collection_drops
          where guild_id = ${guildId} and channel_id = ${channelId} and claimed_by is null
            and expires_at > now()
          order by id desc
          limit 1
          for update skip locked
        )
        returning ${dropColumns(tx)}
      `;
      if (!row) return null;
      await tx`
        insert into collection_owned (guild_id, user_id, card_id, count)
        values (${guildId}, ${userId}, ${row.cardId}, 1)
        on conflict (guild_id, user_id, card_id) do update set count = collection_owned.count + 1
      `;
      return row;
    });
  }

  async wishlist(guildId: string, userId: string): Promise<Card[]> {
    return this.sql<Card[]>`
      select ${cardColumns(this.sql)} from collection_wishlist w
      join collection_cards c on c.id = w.card_id
      where w.guild_id = ${guildId} and w.user_id = ${userId}
      order by w.created_at
    `;
  }

  async wish(
    guildId: string,
    userId: string,
    cardId: string,
    limit: number,
  ): Promise<'added' | 'full' | 'exists'> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`collection.wish:${guildId}:${userId}`}))`;
      const [size] = await tx<{ count: number }[]>`
        select count(*)::int as count from collection_wishlist
        where guild_id = ${guildId} and user_id = ${userId}
      `;
      const rows = await tx`
        select 1 from collection_wishlist
        where guild_id = ${guildId} and user_id = ${userId} and card_id = ${cardId}
      `;
      if (rows.length > 0) return 'exists' as const;
      if ((size?.count ?? 0) >= limit) return 'full' as const;
      await tx`
        insert into collection_wishlist (guild_id, user_id, card_id) values (${guildId}, ${userId}, ${cardId})
      `;
      return 'added' as const;
    });
  }

  async unwish(guildId: string, userId: string, cardId: string): Promise<boolean> {
    const rows = await this.sql`
      delete from collection_wishlist
      where guild_id = ${guildId} and user_id = ${userId} and card_id = ${cardId}
      returning 1
    `;
    return rows.length > 0;
  }

  async wishers(guildId: string, cardId: string, limit = 10): Promise<string[]> {
    const rows = await this.sql<{ userId: string }[]>`
      select user_id::text as "userId" from collection_wishlist
      where guild_id = ${guildId} and card_id = ${cardId}
      order by created_at
      limit ${limit}
    `;
    return rows.map((row) => row.userId);
  }

  async markSetDone(guildId: string, userId: string, setId: string): Promise<boolean> {
    const rows = await this.sql`
      insert into collection_set_rewards (guild_id, user_id, set_id) values (${guildId}, ${userId}, ${setId})
      on conflict do nothing
      returning 1
    `;
    return rows.length > 0;
  }

  async setsDone(guildId: string, userId: string): Promise<Set<string>> {
    const rows = await this.sql<{ setId: string }[]>`
      select set_id as "setId" from collection_set_rewards where guild_id = ${guildId} and user_id = ${userId}
    `;
    return new Set(rows.map((row) => row.setId));
  }

  async createTrade(input: {
    guildId: string;
    channelId: string;
    fromUser: string;
    toUser: string;
    give: readonly string[];
    want: readonly string[];
    expiresAt: Date;
  }): Promise<Trade> {
    const [row] = await this.sql<Trade[]>`
      insert into collection_trades (guild_id, channel_id, from_user, to_user, give, want, expires_at)
      values (${input.guildId}, ${input.channelId}, ${input.fromUser}, ${input.toUser},
        ${[...input.give]}::bigint[], ${[...input.want]}::bigint[], ${input.expiresAt})
      returning ${tradeColumns(this.sql)}
    `;
    if (!row) throw new Error('trade insert returned nothing');
    return row;
  }

  async setTradeMessage(tradeId: string, messageId: string): Promise<void> {
    await this.sql`update collection_trades set message_id = ${messageId} where id = ${tradeId}`;
  }

  async trade(tradeId: string): Promise<Trade | null> {
    const [row] = await this.sql<Trade[]>`
      select ${tradeColumns(this.sql)} from collection_trades where id = ${tradeId}
    `;
    return row ?? null;
  }

  async tradeByMessage(messageId: string): Promise<Trade | null> {
    const [row] = await this.sql<Trade[]>`
      select ${tradeColumns(this.sql)} from collection_trades
      where message_id = ${messageId} and status = 'open'
    `;
    return row ?? null;
  }

  async openTrades(): Promise<Trade[]> {
    return this.sql<Trade[]>`
      select ${tradeColumns(this.sql)} from collection_trades
      where status = 'open' and message_id is not null and expires_at > now()
    `;
  }

  async openTradeBetween(guildId: string, userId: string): Promise<Trade | null> {
    const [row] = await this.sql<Trade[]>`
      select ${tradeColumns(this.sql)} from collection_trades
      where guild_id = ${guildId} and status = 'open' and expires_at > now()
        and (from_user = ${userId} or to_user = ${userId})
      limit 1
    `;
    return row ?? null;
  }

  async confirmTrade(tradeId: string, userId: string): Promise<Trade | null> {
    const [row] = await this.sql<Trade[]>`
      update collection_trades set
        from_ok = from_ok or from_user = ${userId},
        to_ok = to_ok or to_user = ${userId}
      where id = ${tradeId} and status = 'open' and expires_at > now()
        and (from_user = ${userId} or to_user = ${userId})
      returning ${tradeColumns(this.sql)}
    `;
    return row ?? null;
  }

  async closeTrade(
    tradeId: string,
    status: Exclude<TradeStatus, 'open' | 'done'>,
    guildId?: string,
  ): Promise<Trade | null> {
    const [row] = await this.sql<Trade[]>`
      update collection_trades set status = ${status}
      where id = ${tradeId} and status = 'open'
        ${guildId === undefined ? this.sql`` : this.sql`and guild_id = ${guildId}`}
      returning ${tradeColumns(this.sql)}
    `;
    return row ?? null;
  }

  async executeTrade(tradeId: string): Promise<'done' | 'missing' | 'closed'> {
    try {
      return await this.sql.begin(async (tx) => {
        const [trade] = await tx<Trade[]>`
          select ${tradeColumns(tx)} from collection_trades where id = ${tradeId} for update
        `;
        if (trade?.status !== 'open' || !trade.fromOk || !trade.toOk) return 'closed' as const;
        const moves: [string, string, string[]][] = [
          [trade.fromUser, trade.toUser, trade.give],
          [trade.toUser, trade.fromUser, trade.want],
        ];
        for (const [from, , ids] of moves) {
          for (const [cardId, count] of tally(ids)) {
            const rows = await tx`
              select 1 from collection_owned
              where guild_id = ${trade.guildId} and user_id = ${from} and card_id = ${cardId}
                and count >= ${count}
              for update
            `;
            if (rows.length === 0) throw new Missing();
          }
        }
        for (const [from, to, ids] of moves) {
          for (const [cardId, count] of tally(ids)) {
            await this.#take(tx, trade.guildId, from, cardId, count);
            await tx`
              insert into collection_owned (guild_id, user_id, card_id, count)
              values (${trade.guildId}, ${to}, ${cardId}, ${count})
              on conflict (guild_id, user_id, card_id) do update
                set count = collection_owned.count + excluded.count
            `;
          }
        }
        await tx`update collection_trades set status = 'done' where id = ${tradeId}`;
        return 'done' as const;
      });
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
      await this.closeTrade(tradeId, 'failed');
      return 'missing';
    }
  }

  async memberData(guildId: string, userId: string): Promise<MemberData | null> {
    const card = await this.memberCard(guildId, userId);
    const owned = await this.sql<MemberData['owned']>`
      select c.id::text as "cardId", c.number, c.name, c.deck, o.count, o.first_at as "firstAt"
      from collection_owned o join collection_cards c on c.id = o.card_id
      where o.guild_id = ${guildId} and o.user_id = ${userId} and o.count > 0
      order by c.id
    `;
    const wishlist = await this.sql<MemberData['wishlist']>`
      select c.id::text as "cardId", c.number, c.name, w.created_at as "createdAt"
      from collection_wishlist w join collection_cards c on c.id = w.card_id
      where w.guild_id = ${guildId} and w.user_id = ${userId}
      order by w.created_at
    `;
    const sets = await this.sql<MemberData['sets']>`
      select set_id as "setId", rewarded_at as "rewardedAt" from collection_set_rewards
      where guild_id = ${guildId} and user_id = ${userId}
      order by rewarded_at
    `;
    const activity = await this.sql<MemberData['activity']>`
      select to_char(day, 'YYYY-MM-DD') as day, messages from collection_activity
      where guild_id = ${guildId} and user_id = ${userId}
      order by day
    `;
    const drops = await this.sql<MemberData['drops']>`
      select d.card_id::text as "cardId", c.number, d.claimed_at as "claimedAt"
      from collection_drops d left join collection_cards c on c.id = d.card_id
      where d.guild_id = ${guildId} and d.claimed_by = ${userId}
      order by d.id
    `;
    const trades = await this.sql<MemberData['trades']>`
      select status, from_user = ${userId} as proposed,
        (case when from_user = ${userId} then to_user else from_user end)::text as "otherId",
        (case when from_user = ${userId} then give else want end)::text[] as gave,
        (case when from_user = ${userId} then want else give end)::text[] as got,
        array(
          select c.number from unnest(case when t.from_user = ${userId} then t.give else t.want end)
            with ordinality as u (id, n)
          join collection_cards c on c.id = u.id
          order by u.n
        ) as "gaveNumbers",
        array(
          select c.number from unnest(case when t.from_user = ${userId} then t.want else t.give end)
            with ordinality as u (id, n)
          join collection_cards c on c.id = u.id
          order by u.n
        ) as "gotNumbers",
        created_at as "createdAt"
      from collection_trades t
      where guild_id = ${guildId} and (from_user = ${userId} or to_user = ${userId})
      order by id
    `;
    const data: MemberData = {
      card: card
        ? {
            id: card.id,
            number: card.number,
            name: card.name,
            rarity: card.rarity,
            active: card.active,
            createdAt: card.createdAt,
          }
        : null,
      owned: [...owned],
      wishlist: [...wishlist],
      sets: [...sets],
      activity: [...activity],
      drops: [...drops],
      trades: [...trades],
    };
    const empty =
      !data.card &&
      [data.owned, data.wishlist, data.sets, data.activity, data.drops, data.trades].every(
        (list) => list.length === 0,
      );
    return empty ? null : data;
  }

  async forget(guildId: string, userId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`delete from collection_owned where guild_id = ${guildId} and user_id = ${userId}`;
      await tx`delete from collection_wishlist where guild_id = ${guildId} and user_id = ${userId}`;
      await tx`delete from collection_set_rewards where guild_id = ${guildId} and user_id = ${userId}`;
      await tx`delete from collection_activity where guild_id = ${guildId} and user_id = ${userId}`;
      await tx`delete from collection_cards where guild_id = ${guildId} and member_id = ${userId}`;
      await tx`delete from collection_drops where guild_id = ${guildId} and claimed_by = ${userId}`;
      await tx`
        delete from collection_trades
        where guild_id = ${guildId} and (from_user = ${userId} or to_user = ${userId})
      `;
    });
  }

  async #lock(tx: Db, guildId: string): Promise<void> {
    await tx`select pg_advisory_xact_lock(hashtext(${`collection:${guildId}`}))`;
  }

  #next(tx: Db, guildId: string) {
    return tx`(select coalesce(max(number), 0) + 1 from collection_cards where guild_id = ${guildId})`;
  }

  async #take(
    tx: Db,
    guildId: string,
    userId: string,
    cardId: string,
    count: number,
  ): Promise<void> {
    await tx`
      update collection_owned set count = count - ${count}
      where guild_id = ${guildId} and user_id = ${userId} and card_id = ${cardId}
    `;
    await tx`
      delete from collection_owned
      where guild_id = ${guildId} and user_id = ${userId} and card_id = ${cardId} and count <= 0
    `;
  }
}
