import type postgres from 'postgres';
import type { Sql } from '../db/sql.js';

type Db = Sql | postgres.TransactionSql;

export type Supply = 'mint' | 'burn' | 'none';

export interface MoveOptions {
  note?: string | null;
  ref?: string | null;
  counterpartId?: string | null;
  supply?: Supply;
}

export interface Wallet {
  balance: number;
  earnedToday: number;
  dailyAt: Date | null;
  dailyStreak: number;
  background: string | null;
}

export interface Transaction {
  id: string;
  guildId: string;
  userId: string;
  amount: number;
  balance: number;
  kind: string;
  note: string | null;
  ref: string | null;
  counterpartId: string | null;
  createdAt: Date;
}

export interface SupplyDay {
  day: string;
  minted: number;
  burned: number;
  supply: number;
}

export interface Holder {
  userId: string;
  balance: number;
}

export interface DailyRules {
  amount: number;
  streakBonus: number;
  streakCap: number;
}

export type DailyResult =
  | { ok: true; amount: number; streak: number; balance: number; readyAt: Date }
  | { ok: false; readyAt: Date };

export type TransferResult =
  | { ok: true; sent: number; tax: number; received: number; balance: number }
  | { ok: false };

export interface ExchangeOp {
  userId: string;
  delta: number;
  kind: string;
  note?: string | null;
  ref?: string | null;
  counterpartId?: string | null;
}

export interface PurchaseInput {
  itemId: string;
  kind: string;
  price: number;
  stock: number | null;
  perUser: number | null;
  ref: string | null;
  inventory: boolean;
  unique: boolean;
}

export type PurchaseResult =
  | { ok: true; purchaseId: string; balance: number }
  | { ok: false; reason: 'sold_out' | 'limit' | 'funds' | 'owned' };

export interface Purchase {
  id: string;
  userId: string;
  itemId: string;
  kind: string;
  price: number;
  ref: string | null;
  createdAt: Date;
  refundedAt: Date | null;
}

export interface InventoryItem {
  kind: string;
  ref: string;
  quantity: number;
}

export interface Reset {
  id: string;
  members: number;
  total: number;
}

export interface EconomyOverview {
  wallets: number;
  supply: number;
  earnedToday: number;
  atCap: number;
  spentWeek: number;
  topItem: string | null;
  taxedMonth: number;
  createdMonth: number;
  spentMonth: number;
}

export interface KindTotal {
  kind: string;
  credited: number;
  debited: number;
}

export type MemberData = {
  wallet: {
    balance: number;
    dailyAt: Date | null;
    dailyStreak: number;
    background: string | null;
    updatedAt: Date;
  } | null;
  transactions: {
    amount: number;
    balance: number;
    kind: string;
    note: string | null;
    ref: string | null;
    counterpartId: string | null;
    createdAt: Date;
  }[];
  purchases: {
    itemId: string;
    kind: string;
    price: number;
    ref: string | null;
    createdAt: Date;
    refundedAt: Date | null;
  }[];
  inventory: InventoryItem[];
  resets: { balance: number; createdAt: Date; restoredAt: Date | null }[];
};

export const DAY_MS = 24 * 60 * 60 * 1000;
const ANY = '*';
const TAX_NOTE = '^tax ([0-9]+)$';

class Insufficient extends Error {}

export function dailyAmount(rules: DailyRules, streak: number): number {
  const steps = Math.max(0, Math.min(streak, rules.streakCap) - 1);
  return rules.amount + rules.streakBonus * steps;
}

export function nextStreak(last: Date | null, streak: number, now: Date): number {
  if (!last) return 1;
  return now.getTime() - last.getTime() < 2 * DAY_MS ? streak + 1 : 1;
}

export function splitTax(amount: number, percent: number): { tax: number; received: number } {
  const tax = Math.floor((amount * Math.min(Math.max(percent, 0), 100)) / 100);
  return { tax, received: amount - tax };
}

export function cappedAmount(amount: number, earnedToday: number, cap: number | null): number {
  if (amount <= 0) return 0;
  if (cap === null) return amount;
  return Math.max(0, Math.min(amount, cap - earnedToday));
}

function whole(amount: number): number {
  if (!Number.isFinite(amount)) throw new RangeError('amount must be finite');
  return Math.trunc(amount);
}

export class EconomyStore {
  constructor(private readonly sql: Sql) {}

  async open(guildId: string, userId: string, starting = 0): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        insert into economy_wallets (guild_id, user_id) values (${guildId}, ${userId})
        on conflict (guild_id, user_id) do nothing
        returning user_id
      `;
      if (rows.length === 0) return false;
      if (starting > 0) await this.#move(tx, guildId, userId, whole(starting), 'start', {});
      return true;
    });
  }

  async balance(guildId: string, userId: string): Promise<number> {
    const [row] = await this.sql<{ balance: number }[]>`
      select balance::float8 as balance from economy_wallets
      where guild_id = ${guildId} and user_id = ${userId}
    `;
    return row?.balance ?? 0;
  }

  async wallet(guildId: string, userId: string): Promise<Wallet> {
    const [row] = await this.sql<Wallet[]>`
      select balance::float8 as balance,
        case when earned_day = (now() at time zone 'utc')::date then earned_today else 0 end::float8
          as "earnedToday",
        daily_at as "dailyAt", daily_streak as "dailyStreak", background
      from economy_wallets
      where guild_id = ${guildId} and user_id = ${userId}
    `;
    return row ?? { balance: 0, earnedToday: 0, dailyAt: null, dailyStreak: 0, background: null };
  }

  async credit(
    guildId: string,
    userId: string,
    amount: number,
    kind: string,
    options: MoveOptions = {},
  ): Promise<number> {
    const value = whole(amount);
    if (value < 0) throw new RangeError('credit needs a positive amount');
    return this.sql.begin(async (tx) => {
      const balance = await this.#move(tx, guildId, userId, value, kind, {
        supply: 'mint',
        ...options,
      });
      return balance ?? 0;
    });
  }

  async debit(
    guildId: string,
    userId: string,
    amount: number,
    kind: string,
    options: MoveOptions = {},
  ): Promise<boolean> {
    const value = whole(amount);
    if (value < 0) throw new RangeError('debit needs a positive amount');
    return this.sql.begin(async (tx) => {
      const balance = await this.#move(tx, guildId, userId, -value, kind, {
        supply: 'burn',
        ...options,
      });
      return balance !== null;
    });
  }

  async adjust(
    guildId: string,
    userId: string,
    delta: number,
    kind: string,
    options: MoveOptions = {},
  ): Promise<{ applied: number; balance: number }> {
    const value = whole(delta);
    return this.sql.begin(async (tx) => {
      await tx`
        insert into economy_wallets (guild_id, user_id) values (${guildId}, ${userId})
        on conflict (guild_id, user_id) do nothing
      `;
      const [row] = await tx<{ balance: number }[]>`
        select balance::float8 as balance from economy_wallets
        where guild_id = ${guildId} and user_id = ${userId}
        for update
      `;
      const current = row?.balance ?? 0;
      const applied = value < 0 ? -Math.min(current, -value) : value;
      if (applied === 0) return { applied: 0, balance: current };
      const balance = await this.#move(tx, guildId, userId, applied, kind, {
        supply: applied > 0 ? 'mint' : 'burn',
        ...options,
      });
      return { applied, balance: balance ?? current };
    });
  }

  async earn(
    guildId: string,
    userId: string,
    amount: number,
    kind: string,
    cap: number | null,
    options: MoveOptions = {},
  ): Promise<{ credited: number; balance: number }> {
    const value = whole(amount);
    return this.sql.begin(async (tx) => {
      await tx`
        insert into economy_wallets (guild_id, user_id) values (${guildId}, ${userId})
        on conflict (guild_id, user_id) do nothing
      `;
      const [row] = await tx<{ balance: number; earnedToday: number }[]>`
        select balance::float8 as balance,
          case when earned_day = (now() at time zone 'utc')::date then earned_today else 0 end::float8
            as "earnedToday"
        from economy_wallets
        where guild_id = ${guildId} and user_id = ${userId}
        for update
      `;
      const earned = row?.earnedToday ?? 0;
      const credited = cappedAmount(value, earned, cap);
      if (credited <= 0) return { credited: 0, balance: row?.balance ?? 0 };
      await tx`
        update economy_wallets
        set earned_day = (now() at time zone 'utc')::date, earned_today = ${earned + credited}
        where guild_id = ${guildId} and user_id = ${userId}
      `;
      const balance = await this.#move(tx, guildId, userId, credited, kind, {
        supply: 'mint',
        ...options,
      });
      return { credited, balance: balance ?? 0 };
    });
  }

  async claimDaily(
    guildId: string,
    userId: string,
    rules: DailyRules,
    now = new Date(),
  ): Promise<DailyResult> {
    return this.sql.begin(async (tx) => {
      await tx`
        insert into economy_wallets (guild_id, user_id) values (${guildId}, ${userId})
        on conflict (guild_id, user_id) do nothing
      `;
      const [row] = await tx<{ dailyAt: Date | null; dailyStreak: number }[]>`
        select daily_at as "dailyAt", daily_streak as "dailyStreak" from economy_wallets
        where guild_id = ${guildId} and user_id = ${userId}
        for update
      `;
      const last = row?.dailyAt ?? null;
      if (last && now.getTime() - last.getTime() < DAY_MS) {
        return { ok: false as const, readyAt: new Date(last.getTime() + DAY_MS) };
      }
      const streak = nextStreak(last, row?.dailyStreak ?? 0, now);
      const amount = dailyAmount(rules, streak);
      await tx`
        update economy_wallets set daily_at = ${now}, daily_streak = ${streak}
        where guild_id = ${guildId} and user_id = ${userId}
      `;
      const balance =
        amount > 0
          ? await this.#move(tx, guildId, userId, amount, 'daily', { supply: 'mint' })
          : await this.#balance(tx, guildId, userId);
      return {
        ok: true as const,
        amount,
        streak,
        balance: balance ?? 0,
        readyAt: new Date(now.getTime() + DAY_MS),
      };
    });
  }

  async transfer(
    guildId: string,
    fromId: string,
    toId: string,
    amount: number,
    taxPercent: number,
  ): Promise<TransferResult> {
    const value = whole(amount);
    if (value <= 0 || fromId === toId) return { ok: false };
    const { tax, received } = splitTax(value, taxPercent);
    try {
      return await this.sql.begin(async (tx) => {
        const balance = await this.#move(tx, guildId, fromId, -value, 'transfer', {
          counterpartId: toId,
          note: tax > 0 ? `tax ${tax}` : null,
          supply: 'none',
        });
        if (balance === null) throw new Insufficient();
        if (received > 0) {
          await this.#move(tx, guildId, toId, received, 'transfer', {
            counterpartId: fromId,
            supply: 'none',
          });
        }
        if (tax > 0) await this.#supply(tx, guildId, 0, tax);
        return { ok: true as const, sent: value, tax, received, balance };
      });
    } catch (error) {
      if (error instanceof Insufficient) return { ok: false };
      throw error;
    }
  }

  async exchange(
    guildId: string,
    ops: readonly ExchangeOp[],
    supply: Supply = 'none',
  ): Promise<boolean> {
    const ordered = [...ops].sort((a, b) =>
      a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0,
    );
    try {
      await this.sql.begin(async (tx) => {
        for (const op of ordered) {
          const delta = whole(op.delta);
          if (delta === 0) continue;
          const balance = await this.#move(tx, guildId, op.userId, delta, op.kind, {
            note: op.note ?? null,
            ref: op.ref ?? null,
            counterpartId: op.counterpartId ?? null,
            supply,
          });
          if (balance === null) throw new Insufficient();
        }
      });
      return true;
    } catch (error) {
      if (error instanceof Insufficient) return false;
      throw error;
    }
  }

  async richest(guildId: string, limit = 10, offset = 0): Promise<Holder[]> {
    return this.sql<Holder[]>`
      select user_id as "userId", balance::float8 as balance
      from economy_wallets
      where guild_id = ${guildId} and balance > 0
      order by balance desc, user_id
      limit ${Math.min(Math.max(limit, 1), 500)} offset ${Math.max(offset, 0)}
    `;
  }

  async rank(guildId: string, userId: string): Promise<{ rank: number; balance: number } | null> {
    const [row] = await this.sql<{ rank: number; balance: number }[]>`
      select
        (select count(*)::int + 1 from economy_wallets o
          where o.guild_id = w.guild_id and o.balance > w.balance) as rank,
        w.balance::float8 as balance
      from economy_wallets w
      where w.guild_id = ${guildId} and w.user_id = ${userId} and w.balance > 0
    `;
    return row ?? null;
  }

  async transactions(
    guildId: string,
    options: { userId?: string; before?: string; kind?: string; limit?: number } = {},
  ): Promise<Transaction[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    return this.sql<Transaction[]>`
      select id::text as id, guild_id::text as "guildId", user_id::text as "userId",
        amount::float8 as amount, balance::float8 as balance, kind, note, ref,
        counterpart_id::text as "counterpartId", created_at as "createdAt"
      from economy_transactions
      where guild_id = ${guildId}
        ${options.userId ? this.sql`and user_id = ${options.userId}` : this.sql``}
        ${options.kind ? this.sql`and kind = ${options.kind}` : this.sql``}
        ${options.before ? this.sql`and id < ${options.before}` : this.sql``}
      order by id desc
      limit ${limit}
    `;
  }

  async totalSupply(guildId: string): Promise<number> {
    const [row] = await this.sql<{ total: number }[]>`
      select coalesce(sum(balance), 0)::float8 as total from economy_wallets where guild_id = ${guildId}
    `;
    return row?.total ?? 0;
  }

  async supplyHistory(guildId: string, days = 30): Promise<SupplyDay[]> {
    const span = Math.min(Math.max(days, 1), 365);
    return this.sql<SupplyDay[]>`
      select day, minted, burned, supply from (
        select to_char(day, 'YYYY-MM-DD') as day,
          minted::float8 as minted,
          burned::float8 as burned,
          (sum(minted - burned) over (order by day))::float8 as supply,
          day as at
        from economy_supply
        where guild_id = ${guildId}
      ) history
      where at > (now() at time zone 'utc')::date - ${span}::int
      order by at
    `;
  }

  async purchase(guildId: string, userId: string, item: PurchaseInput): Promise<PurchaseResult> {
    const ref = item.ref ?? ANY;
    try {
      return await this.sql.begin(async (tx) => {
        await tx`
          insert into economy_stock (guild_id, item_id) values (${guildId}, ${item.itemId})
          on conflict (guild_id, item_id) do nothing
        `;
        const [stock] = await tx<{ sold: number }[]>`
          select sold from economy_stock
          where guild_id = ${guildId} and item_id = ${item.itemId}
          for update
        `;
        const sold = stock?.sold ?? 0;
        if (item.stock !== null && sold >= item.stock)
          return { ok: false as const, reason: 'sold_out' as const };

        if (item.unique) {
          const [owned] = await tx<{ quantity: number }[]>`
            select quantity from economy_inventory
            where guild_id = ${guildId} and user_id = ${userId} and kind = ${item.kind} and ref = ${ref}
          `;
          if ((owned?.quantity ?? 0) > 0) return { ok: false as const, reason: 'owned' as const };
        }

        if (item.perUser !== null) {
          const [bought] = await tx<{ count: number }[]>`
            select count(*)::int as count from economy_purchases
            where guild_id = ${guildId} and user_id = ${userId} and item_id = ${item.itemId}
              and refunded_at is null
          `;
          if ((bought?.count ?? 0) >= item.perUser)
            return { ok: false as const, reason: 'limit' as const };
        }

        const balance = await this.#move(tx, guildId, userId, -whole(item.price), 'shop', {
          ref: item.itemId,
          supply: 'burn',
        });
        if (balance === null) return { ok: false as const, reason: 'funds' as const };

        await tx`
          update economy_stock set sold = sold + 1
          where guild_id = ${guildId} and item_id = ${item.itemId}
        `;
        const [row] = await tx<{ id: string }[]>`
          insert into economy_purchases (guild_id, user_id, item_id, kind, price, ref)
          values (${guildId}, ${userId}, ${item.itemId}, ${item.kind}, ${whole(item.price)}, ${item.ref})
          returning id::text as id
        `;
        if (item.inventory) await this.#grant(tx, guildId, userId, item.kind, ref, 1);
        return { ok: true as const, purchaseId: row?.id ?? '', balance };
      });
    } catch (error) {
      if (error instanceof Insufficient) return { ok: false, reason: 'funds' };
      throw error;
    }
  }

  async refund(guildId: string, purchaseId: string, inventory: boolean): Promise<Purchase | null> {
    return this.sql.begin(async (tx) => {
      const [row] = await tx<Purchase[]>`
        update economy_purchases set refunded_at = now()
        where guild_id = ${guildId} and id = ${purchaseId} and refunded_at is null
        returning id::text as id, user_id::text as "userId", item_id as "itemId", kind,
          price::float8 as price, ref, created_at as "createdAt", refunded_at as "refundedAt"
      `;
      if (!row) return null;
      if (row.price > 0) {
        await this.#move(tx, guildId, row.userId, row.price, 'refund', {
          ref: row.itemId,
          supply: 'mint',
        });
      }
      await tx`
        update economy_stock set sold = greatest(sold - 1, 0)
        where guild_id = ${guildId} and item_id = ${row.itemId}
      `;
      if (inventory) {
        await tx`
          update economy_inventory set quantity = greatest(quantity - 1, 0)
          where guild_id = ${guildId} and user_id = ${row.userId} and kind = ${row.kind}
            and ref = ${row.ref ?? ANY}
        `;
      }
      return row;
    });
  }

  async purchases(
    guildId: string,
    options: { userId?: string; before?: string; limit?: number } = {},
  ): Promise<Purchase[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    return this.sql<Purchase[]>`
      select id::text as id, user_id::text as "userId", item_id as "itemId", kind,
        price::float8 as price, ref, created_at as "createdAt", refunded_at as "refundedAt"
      from economy_purchases
      where guild_id = ${guildId}
        ${options.userId ? this.sql`and user_id = ${options.userId}` : this.sql``}
        ${options.before ? this.sql`and id < ${options.before}` : this.sql``}
      order by id desc
      limit ${limit}
    `;
  }

  async findPurchase(guildId: string, purchaseId: string): Promise<Purchase | null> {
    const [row] = await this.sql<Purchase[]>`
      select id::text as id, user_id::text as "userId", item_id as "itemId", kind,
        price::float8 as price, ref, created_at as "createdAt", refunded_at as "refundedAt"
      from economy_purchases
      where guild_id = ${guildId} and id = ${purchaseId}
    `;
    return row ?? null;
  }

  async soldCounts(guildId: string): Promise<Map<string, number>> {
    const rows = await this.sql<{ itemId: string; sold: number }[]>`
      select item_id as "itemId", sold from economy_stock where guild_id = ${guildId}
    `;
    return new Map(rows.map((row) => [row.itemId, row.sold]));
  }

  async setSold(guildId: string, itemId: string, sold: number): Promise<number> {
    return this.sql.begin(async (tx) => {
      const [before] = await tx<{ sold: number }[]>`
        select sold from economy_stock where guild_id = ${guildId} and item_id = ${itemId} for update
      `;
      await tx`
        insert into economy_stock (guild_id, item_id, sold) values (${guildId}, ${itemId}, ${Math.max(0, whole(sold))})
        on conflict (guild_id, item_id) do update set sold = excluded.sold
      `;
      return before?.sold ?? 0;
    });
  }

  async inventory(guildId: string, userId: string): Promise<InventoryItem[]> {
    return this.sql<InventoryItem[]>`
      select kind, ref, quantity from economy_inventory
      where guild_id = ${guildId} and user_id = ${userId} and quantity > 0
      order by kind, ref
    `;
  }

  async grantItem(
    guildId: string,
    userId: string,
    kind: string,
    ref: string | null,
    quantity = 1,
  ): Promise<void> {
    await this.#grant(this.sql, guildId, userId, kind, ref ?? ANY, quantity);
  }

  async takeItem(
    guildId: string,
    userId: string,
    kind: string,
    ref: string | null,
  ): Promise<boolean> {
    const rows = await this.sql`
      update economy_inventory set quantity = quantity - 1
      where guild_id = ${guildId} and user_id = ${userId} and kind = ${kind} and ref = ${ref ?? ANY}
        and quantity > 0
      returning quantity
    `;
    return rows.length > 0;
  }

  async owns(guildId: string, userId: string, kind: string, ref: string | null): Promise<boolean> {
    const [row] = await this.sql<{ quantity: number }[]>`
      select quantity from economy_inventory
      where guild_id = ${guildId} and user_id = ${userId} and kind = ${kind} and ref = ${ref ?? ANY}
    `;
    return (row?.quantity ?? 0) > 0;
  }

  async giveawayEntries(
    guildId: string,
    userId: string,
    giveawayId: string | null,
  ): Promise<number> {
    const [row] = await this.sql<{ total: number }[]>`
      select coalesce(sum(quantity), 0)::int as total from economy_inventory
      where guild_id = ${guildId} and user_id = ${userId} and kind = 'giveaway'
        and ref in (${ANY}, ${giveawayId ?? ANY})
    `;
    return row?.total ?? 0;
  }

  async useGiveawayEntries(
    guildId: string,
    giveawayId: string | null,
  ): Promise<Map<string, number>> {
    const rows = await this.sql<{ userId: string; quantity: number }[]>`
      with held as (
        select user_id, ref, quantity from economy_inventory
        where guild_id = ${guildId} and kind = 'giveaway' and ref in (${ANY}, ${giveawayId ?? ANY})
          and quantity > 0
        for update
      ), cleared as (
        update economy_inventory i set quantity = 0
        from held
        where i.guild_id = ${guildId} and i.kind = 'giveaway' and i.user_id = held.user_id
          and i.ref = held.ref
      )
      select user_id::text as "userId", sum(quantity)::int as quantity from held group by user_id
    `;
    return new Map(rows.map((row) => [row.userId, row.quantity]));
  }

  async background(guildId: string, userId: string): Promise<string | null> {
    const [row] = await this.sql<{ background: string | null }[]>`
      select background from economy_wallets where guild_id = ${guildId} and user_id = ${userId}
    `;
    return row?.background ?? null;
  }

  async setBackground(guildId: string, userId: string, assetKey: string | null): Promise<void> {
    await this.sql`
      insert into economy_wallets (guild_id, user_id, background) values (${guildId}, ${userId}, ${assetKey})
      on conflict (guild_id, user_id) do update set background = excluded.background, updated_at = now()
    `;
  }

  async reset(guildId: string): Promise<Reset | null> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`economy.reset:${guildId}`}))`;
      const [head] = await tx<{ id: string }[]>`
        insert into economy_resets (guild_id) values (${guildId}) returning id::text as id
      `;
      if (!head) throw new Error('reset insert returned nothing');
      const [saved] = await tx<{ members: number; total: number }[]>`
        with locked as (
          select user_id, balance from economy_wallets
          where guild_id = ${guildId} and balance > 0
          for update
        ), saved as (
          insert into economy_reset_balances (reset_id, guild_id, user_id, balance)
          select ${head.id}, ${guildId}, user_id, balance from locked
          returning balance
        )
        select count(*)::int as members, coalesce(sum(balance), 0)::float8 as total from saved
      `;
      const members = saved?.members ?? 0;
      const total = saved?.total ?? 0;
      if (members === 0) {
        await tx`delete from economy_resets where id = ${head.id}`;
        return null;
      }
      await tx`
        update economy_wallets w set balance = w.balance - s.balance, updated_at = now()
        from economy_reset_balances s
        where s.reset_id = ${head.id} and w.guild_id = s.guild_id and w.user_id = s.user_id
      `;
      await tx`
        insert into economy_transactions (guild_id, user_id, amount, balance, kind, ref)
        select s.guild_id, s.user_id, -s.balance, w.balance, 'reset', ${head.id}
        from economy_reset_balances s
        join economy_wallets w on w.guild_id = s.guild_id and w.user_id = s.user_id
        where s.reset_id = ${head.id}
      `;
      await tx`
        update economy_resets set members = ${members}, total = ${total}::bigint where id = ${head.id}
      `;
      await this.#supply(tx, guildId, 0, total);
      return { id: head.id, members, total };
    });
  }

  async restoreReset(guildId: string, resetId: string): Promise<Reset | null> {
    if (!/^\d{1,18}$/.test(resetId)) return null;
    return this.sql.begin(async (tx) => {
      const [head] = await tx<{ id: string }[]>`
        update economy_resets set restored_at = now()
        where guild_id = ${guildId} and id = ${resetId} and restored_at is null
        returning id::text as id
      `;
      if (!head) return null;
      const [restored] = await tx<{ members: number; total: number }[]>`
        with snapshot as (
          select user_id, balance from economy_reset_balances where reset_id = ${resetId}
        ), credited as (
          insert into economy_wallets as w (guild_id, user_id, balance)
          select ${guildId}, user_id, balance from snapshot
          on conflict (guild_id, user_id) do update
            set balance = w.balance + excluded.balance, updated_at = now()
          returning w.user_id, w.balance
        ), logged as (
          insert into economy_transactions (guild_id, user_id, amount, balance, kind, ref)
          select ${guildId}, c.user_id, s.balance, c.balance, 'undo', ${resetId}
          from credited c join snapshot s on s.user_id = c.user_id
          returning amount
        )
        select count(*)::int as members, coalesce(sum(amount), 0)::float8 as total from logged
      `;
      const total = restored?.total ?? 0;
      if (total > 0) await this.#supply(tx, guildId, total, 0);
      return { id: resetId, members: restored?.members ?? 0, total };
    });
  }

  async pruneResets(guildId: string, olderThan: Date): Promise<number> {
    const rows = await this.sql`
      delete from economy_resets where guild_id = ${guildId} and created_at < ${olderThan}
      returning 1
    `;
    return rows.length;
  }

  async memberData(guildId: string, userId: string): Promise<MemberData | null> {
    const [wallet] = await this.sql<NonNullable<MemberData['wallet']>[]>`
      select balance::float8 as balance, daily_at as "dailyAt", daily_streak as "dailyStreak",
        background, updated_at as "updatedAt"
      from economy_wallets where guild_id = ${guildId} and user_id = ${userId}
    `;
    const transactions = await this.sql<MemberData['transactions']>`
      select amount::float8 as amount, balance::float8 as balance, kind, note, ref,
        counterpart_id::text as "counterpartId", created_at as "createdAt"
      from economy_transactions where guild_id = ${guildId} and user_id = ${userId}
      order by id
    `;
    const purchases = await this.sql<MemberData['purchases']>`
      select item_id as "itemId", kind, price::float8 as price, ref, created_at as "createdAt",
        refunded_at as "refundedAt"
      from economy_purchases where guild_id = ${guildId} and user_id = ${userId}
      order by id
    `;
    const inventory = await this.inventory(guildId, userId);
    const resets = await this.sql<MemberData['resets']>`
      select s.balance::float8 as balance, r.created_at as "createdAt", r.restored_at as "restoredAt"
      from economy_reset_balances s join economy_resets r on r.id = s.reset_id
      where s.guild_id = ${guildId} and s.user_id = ${userId}
      order by r.id
    `;
    if (
      !wallet &&
      transactions.length === 0 &&
      purchases.length === 0 &&
      inventory.length === 0 &&
      resets.length === 0
    ) {
      return null;
    }
    return {
      wallet: wallet ?? null,
      transactions: [...transactions],
      purchases: [...purchases],
      inventory,
      resets: [...resets],
    };
  }

  async overview(guildId: string, cap: number | null): Promise<EconomyOverview> {
    const [wallets] = await this.sql<
      { wallets: number; supply: number; earnedToday: number; atCap: number }[]
    >`
      select count(*) filter (where balance > 0)::int as wallets,
        coalesce(sum(balance), 0)::float8 as supply,
        coalesce(sum(earned_today) filter (
          where earned_day = (now() at time zone 'utc')::date
        ), 0)::float8 as "earnedToday",
        count(*) filter (
          where ${cap}::bigint is not null and earned_day = (now() at time zone 'utc')::date
            and earned_today >= ${cap}::bigint
        )::int as "atCap"
      from economy_wallets where guild_id = ${guildId}
    `;
    const [flows] = await this.sql<{ spentWeek: number; spentMonth: number; taxedMonth: number }[]>`
      select
        coalesce(-sum(amount) filter (
          where kind in ('shop', 'pack') and created_at > now() - interval '7 days'
        ), 0)::float8 as "spentWeek",
        coalesce(-sum(amount) filter (where kind in ('shop', 'pack')), 0)::float8 as "spentMonth",
        coalesce(sum(substring(note from ${TAX_NOTE}::text)::bigint) filter (
          where kind = 'transfer' and amount < 0
        ), 0)::float8 as "taxedMonth"
      from economy_transactions
      where guild_id = ${guildId} and created_at > now() - interval '30 days'
    `;
    const [top] = await this.sql<{ itemId: string }[]>`
      select item_id as "itemId" from economy_purchases
      where guild_id = ${guildId} and refunded_at is null
        and created_at > now() - interval '7 days'
      group by item_id
      order by sum(price) desc, item_id
      limit 1
    `;
    const [minted] = await this.sql<{ created: number }[]>`
      select coalesce(sum(minted), 0)::float8 as created from economy_supply
      where guild_id = ${guildId} and day > (now() at time zone 'utc')::date - 30
    `;
    return {
      wallets: wallets?.wallets ?? 0,
      supply: wallets?.supply ?? 0,
      earnedToday: wallets?.earnedToday ?? 0,
      atCap: wallets?.atCap ?? 0,
      spentWeek: flows?.spentWeek ?? 0,
      topItem: top?.itemId ?? null,
      taxedMonth: flows?.taxedMonth ?? 0,
      createdMonth: minted?.created ?? 0,
      spentMonth: flows?.spentMonth ?? 0,
    };
  }

  async kindTotals(guildId: string, days = 30, ref?: string): Promise<KindTotal[]> {
    const span = Math.min(Math.max(days, 1), 365);
    return this.sql<KindTotal[]>`
      select kind,
        coalesce(sum(amount) filter (where amount > 0), 0)::float8 as credited,
        coalesce(-sum(amount) filter (where amount < 0), 0)::float8 as debited
      from economy_transactions
      where guild_id = ${guildId} and created_at > now() - make_interval(days => ${span}::int)
        ${ref ? this.sql`and ref = ${ref}` : this.sql``}
      group by kind
      order by kind
    `;
  }

  async forget(guildId: string, userId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      const [wallet] = await tx<{ balance: number }[]>`
        delete from economy_wallets where guild_id = ${guildId} and user_id = ${userId}
        returning balance::float8 as balance
      `;
      if (wallet && wallet.balance > 0) await this.#supply(tx, guildId, 0, wallet.balance);
      await tx`delete from economy_inventory where guild_id = ${guildId} and user_id = ${userId}`;
      await tx`delete from economy_transactions where guild_id = ${guildId} and user_id = ${userId}`;
      await tx`
        update economy_transactions set counterpart_id = null
        where guild_id = ${guildId} and counterpart_id = ${userId}
      `;
      await tx`delete from economy_purchases where guild_id = ${guildId} and user_id = ${userId}`;
      await tx`delete from economy_reset_balances where guild_id = ${guildId} and user_id = ${userId}`;
    });
  }

  async #balance(tx: Db, guildId: string, userId: string): Promise<number | null> {
    const [row] = await tx<{ balance: number }[]>`
      select balance::float8 as balance from economy_wallets
      where guild_id = ${guildId} and user_id = ${userId}
    `;
    return row?.balance ?? null;
  }

  async #move(
    tx: Db,
    guildId: string,
    userId: string,
    delta: number,
    kind: string,
    options: MoveOptions,
  ): Promise<number | null> {
    if (delta === 0) return this.#balance(tx, guildId, userId);
    const rows =
      delta > 0
        ? await tx<{ balance: number }[]>`
            insert into economy_wallets (guild_id, user_id, balance)
            values (${guildId}, ${userId}, ${delta}::bigint)
            on conflict (guild_id, user_id) do update
              set balance = economy_wallets.balance + excluded.balance, updated_at = now()
            returning balance::float8 as balance
          `
        : await tx<{ balance: number }[]>`
            update economy_wallets set balance = balance + ${delta}::bigint, updated_at = now()
            where guild_id = ${guildId} and user_id = ${userId} and balance + ${delta}::bigint >= 0
            returning balance::float8 as balance
          `;
    const row = rows[0];
    if (!row) return null;
    await tx`
      insert into economy_transactions (guild_id, user_id, amount, balance, kind, note, ref, counterpart_id)
      values (
        ${guildId}, ${userId}, ${delta}::bigint, ${row.balance}::bigint, ${kind},
        ${options.note ?? null}, ${options.ref ?? null}, ${options.counterpartId ?? null}
      )
    `;
    const supply = options.supply ?? 'none';
    if (supply === 'mint' && delta > 0) await this.#supply(tx, guildId, delta, 0);
    if (supply === 'burn' && delta < 0) await this.#supply(tx, guildId, 0, -delta);
    return row.balance;
  }

  async #supply(tx: Db, guildId: string, minted: number, burned: number): Promise<void> {
    await tx`
      insert into economy_supply (guild_id, day, minted, burned)
      values (${guildId}, (now() at time zone 'utc')::date, ${minted}::bigint, ${burned}::bigint)
      on conflict (guild_id, day) do update
        set minted = economy_supply.minted + excluded.minted,
          burned = economy_supply.burned + excluded.burned
    `;
  }

  async #grant(
    tx: Db,
    guildId: string,
    userId: string,
    kind: string,
    ref: string,
    quantity: number,
  ): Promise<void> {
    await tx`
      insert into economy_inventory (guild_id, user_id, kind, ref, quantity)
      values (${guildId}, ${userId}, ${kind}, ${ref}, ${quantity})
      on conflict (guild_id, user_id, kind, ref) do update
        set quantity = economy_inventory.quantity + excluded.quantity
    `;
  }
}
