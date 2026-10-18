import type { Sql } from '../db/sql.js';
import type { BonusEntry, GiveawayStatus } from '../modules/giveaways.js';

export interface Giveaway {
  id: string;
  number: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  hostId: string | null;
  prize: string;
  description: string | null;
  winners: number;
  emoji: string;
  status: GiveawayStatus;
  startsAt: Date;
  endsAt: Date;
  endedAt: Date | null;
  requiredRoleId: string | null;
  excludedRoleId: string | null;
  minLevel: number;
  minMemberDays: number;
  bonus: BonusEntry[];
  pingRoleId: string | null;
  dmWinners: boolean;
  createdAt: Date;
}

export interface GiveawayInput {
  guildId: string;
  channelId: string;
  hostId: string | null;
  prize: string;
  winners: number;
  emoji: string;
  startsAt?: Date;
  endsAt: Date;
  description?: string | null;
  requiredRoleId?: string | null;
  excludedRoleId?: string | null;
  minLevel?: number;
  minMemberDays?: number;
  bonus?: BonusEntry[];
  pingRoleId?: string | null;
  dmWinners?: boolean;
}

export interface Entry {
  userId: string;
  weight: number;
}

export interface Winner {
  userId: string;
  round: number;
  drawnAt: Date;
}

export interface GiveawayWithWinners extends Giveaway {
  entries: number;
  winnerIds: string[];
}

export interface MemberEntry {
  giveawayId: string;
  number: number;
  prize: string;
  status: GiveawayStatus;
  weight: number;
  enteredAt: Date;
}

export interface MemberWin {
  giveawayId: string;
  number: number;
  prize: string;
  round: number;
  drawnAt: Date;
}

export interface MemberHosted {
  giveawayId: string;
  number: number;
  prize: string;
  status: GiveawayStatus;
  createdAt: Date;
}

export interface MemberGiveaways {
  entries: MemberEntry[];
  wins: MemberWin[];
  hosted: MemberHosted[];
}

export class GiveawayStore {
  constructor(private readonly sql: Sql) {}

  #columns() {
    return this.sql`
      id::text as id, number, guild_id::text as "guildId", channel_id::text as "channelId",
      message_id::text as "messageId", host_id::text as "hostId", prize, winners, emoji, status,
      starts_at as "startsAt", ends_at as "endsAt", ended_at as "endedAt",
      required_role_id::text as "requiredRoleId", min_level as "minLevel",
      min_member_days as "minMemberDays", bonus, created_at as "createdAt", description,
      excluded_role_id::text as "excludedRoleId", ping_role_id::text as "pingRoleId",
      dm_winners as "dmWinners"
    `;
  }

  async create(input: GiveawayInput): Promise<Giveaway> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`giveaways:${input.guildId}`}))`;
      const [row] = await tx<Giveaway[]>`
        insert into giveaways_items (
          guild_id, number, channel_id, host_id, prize, winners, emoji, starts_at, ends_at,
          required_role_id, min_level, min_member_days, bonus, description, excluded_role_id,
          ping_role_id, dm_winners
        ) values (
          ${input.guildId},
          (select coalesce(max(number), 0) + 1 from giveaways_items where guild_id = ${input.guildId}),
          ${input.channelId}, ${input.hostId}, ${input.prize}, ${input.winners},
          ${input.emoji}, ${input.startsAt ?? new Date()}, ${input.endsAt},
          ${input.requiredRoleId ?? null}, ${input.minLevel ?? 0}, ${input.minMemberDays ?? 0},
          ${tx.json((input.bonus ?? []) as never)}, ${input.description ?? null},
          ${input.excludedRoleId ?? null}, ${input.pingRoleId ?? null}, ${input.dmWinners ?? true}
        )
        returning ${this.#columns()}
      `;
      if (!row) throw new Error('giveaway insert returned nothing');
      return row;
    });
  }

  async get(guildId: string, id: string): Promise<Giveaway | null> {
    if (!/^\d{1,19}$/.test(id)) return null;
    const [row] = await this.sql<Giveaway[]>`
      select ${this.#columns()} from giveaways_items where guild_id = ${guildId} and id = ${id}
    `;
    return row ?? null;
  }

  async byNumber(guildId: string, number: number): Promise<Giveaway | null> {
    if (!Number.isSafeInteger(number) || number < 1 || number > 2_147_483_647) return null;
    const [row] = await this.sql<Giveaway[]>`
      select ${this.#columns()} from giveaways_items
      where guild_id = ${guildId} and number = ${number}
    `;
    return row ?? null;
  }

  async byId(id: string): Promise<Giveaway | null> {
    if (!/^\d{1,19}$/.test(id)) return null;
    const [row] = await this.sql<Giveaway[]>`
      select ${this.#columns()} from giveaways_items where id = ${id}
    `;
    return row ?? null;
  }

  async byMessage(messageId: string): Promise<Giveaway | null> {
    const [row] = await this.sql<Giveaway[]>`
      select ${this.#columns()} from giveaways_items where message_id = ${messageId}
    `;
    return row ?? null;
  }

  async latest(guildId: string, status: GiveawayStatus): Promise<Giveaway | null> {
    const [row] = await this.sql<Giveaway[]>`
      select ${this.#columns()} from giveaways_items
      where guild_id = ${guildId} and status = ${status}
      order by ${status === 'running' ? this.sql`ends_at asc` : this.sql`ended_at desc nulls last`}, id desc
      limit 1
    `;
    return row ?? null;
  }

  async active(guildId: string): Promise<Giveaway[]> {
    return this.sql<Giveaway[]>`
      select ${this.#columns()} from giveaways_items
      where guild_id = ${guildId} and status in ('scheduled', 'running')
      order by ends_at, id
      limit 100
    `;
  }

  async activeWithEntries(guildId: string): Promise<(Giveaway & { entries: number })[]> {
    return this.sql<(Giveaway & { entries: number })[]>`
      select ${this.#columns()},
        (select count(*)::int from giveaways_entries e where e.giveaway_id = g.id) as entries
      from giveaways_items g
      where guild_id = ${guildId} and status in ('scheduled', 'running')
      order by case when status = 'running' then 0 else 1 end, ends_at, id
      limit 100
    `;
  }

  async history(guildId: string, limit = 25, before?: string): Promise<GiveawayWithWinners[]> {
    return this.sql<GiveawayWithWinners[]>`
      select ${this.#columns()},
        (select count(*)::int from giveaways_entries e where e.giveaway_id = g.id) as entries,
        coalesce(
          (select array_agg(w.user_id::text order by w.round, w.drawn_at)
           from giveaways_winners w where w.giveaway_id = g.id),
          '{}'
        ) as "winnerIds"
      from giveaways_items g
      where guild_id = ${guildId} and status = 'ended'
        ${before ? this.sql`and id < ${before}` : this.sql``}
      order by ended_at desc nulls last, id desc
      limit ${Math.min(Math.max(limit, 1), 100)}
    `;
  }

  async markRunning(id: string, messageId: string): Promise<boolean> {
    const rows = await this.sql`
      update giveaways_items set message_id = ${messageId}, status = 'running'
      where id = ${id} and status = 'scheduled'
      returning id
    `;
    return rows.length > 0;
  }

  async finish(id: string): Promise<Giveaway | null> {
    const [row] = await this.sql<Giveaway[]>`
      update giveaways_items set status = 'ended', ended_at = now()
      where id = ${id} and status = 'running'
      returning ${this.#columns()}
    `;
    return row ?? null;
  }

  async cancel(id: string): Promise<Giveaway | null> {
    const [row] = await this.sql<Giveaway[]>`
      update giveaways_items set status = 'cancelled', ended_at = now()
      where id = ${id} and status in ('scheduled', 'running')
      returning ${this.#columns()}
    `;
    return row ?? null;
  }

  async enter(id: string, userId: string, weight: number): Promise<boolean> {
    const rows = await this.sql`
      insert into giveaways_entries (giveaway_id, user_id, weight)
      select ${id}, ${userId}, ${Math.max(1, Math.floor(weight))}
      where exists (select 1 from giveaways_items where id = ${id} and status = 'running')
      on conflict (giveaway_id, user_id) do update set weight = excluded.weight
      returning giveaway_id
    `;
    return rows.length > 0;
  }

  async leave(id: string, userId: string): Promise<boolean> {
    const rows = await this.sql`
      delete from giveaways_entries
      where giveaway_id = ${id} and user_id = ${userId}
        and exists (select 1 from giveaways_items where id = ${id} and status = 'running')
      returning user_id
    `;
    return rows.length > 0;
  }

  async entries(id: string): Promise<Entry[]> {
    return this.sql<Entry[]>`
      select user_id::text as "userId", weight from giveaways_entries
      where giveaway_id = ${id}
      order by entered_at
    `;
  }

  async entryCount(id: string): Promise<number> {
    const [row] = await this.sql<{ count: number }[]>`
      select count(*)::int as count from giveaways_entries where giveaway_id = ${id}
    `;
    return row?.count ?? 0;
  }

  async addWinners(id: string, userIds: readonly string[], round: number): Promise<void> {
    if (userIds.length === 0) return;
    await this.sql`
      insert into giveaways_winners (giveaway_id, user_id, round)
      select ${id}, u.id, ${round} from unnest(${userIds as string[]}::bigint[]) as u (id)
      on conflict do nothing
    `;
  }

  async winners(id: string): Promise<Winner[]> {
    return this.sql<Winner[]>`
      select user_id::text as "userId", round, drawn_at as "drawnAt"
      from giveaways_winners where giveaway_id = ${id}
      order by round, drawn_at
    `;
  }

  async setWeight(id: string, userId: string, weight: number): Promise<void> {
    await this.sql`
      update giveaways_entries set weight = ${Math.max(1, Math.floor(weight))}
      where giveaway_id = ${id} and user_id = ${userId}
    `;
  }

  async memberData(guildId: string, userId: string): Promise<MemberGiveaways> {
    const [entries, wins, hosted] = await Promise.all([
      this.sql<MemberEntry[]>`
        select g.id::text as "giveawayId", g.number, g.prize, g.status, e.weight, e.entered_at as "enteredAt"
        from giveaways_entries e join giveaways_items g on g.id = e.giveaway_id
        where g.guild_id = ${guildId} and e.user_id = ${userId}
        order by e.entered_at
      `,
      this.sql<MemberWin[]>`
        select g.id::text as "giveawayId", g.number, g.prize, w.round, w.drawn_at as "drawnAt"
        from giveaways_winners w join giveaways_items g on g.id = w.giveaway_id
        where g.guild_id = ${guildId} and w.user_id = ${userId}
        order by w.drawn_at
      `,
      this.sql<MemberHosted[]>`
        select id::text as "giveawayId", number, prize, status, created_at as "createdAt"
        from giveaways_items
        where guild_id = ${guildId} and host_id = ${userId}
        order by id
      `,
    ]);
    return { entries, wins, hosted };
  }

  async runningEntered(guildId: string, userId: string): Promise<Giveaway[]> {
    return this.sql<Giveaway[]>`
      select ${this.#columns()} from giveaways_items g
      where g.guild_id = ${guildId} and g.status = 'running'
        and exists (
          select 1 from giveaways_entries e where e.giveaway_id = g.id and e.user_id = ${userId}
        )
    `;
  }

  async forget(guildId: string, userId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`
        delete from giveaways_entries e using giveaways_items g
        where g.id = e.giveaway_id and g.guild_id = ${guildId} and e.user_id = ${userId}
      `;
      await tx`
        delete from giveaways_winners w using giveaways_items g
        where g.id = w.giveaway_id and g.guild_id = ${guildId} and w.user_id = ${userId}
      `;
      await tx`
        update giveaways_items set host_id = null where guild_id = ${guildId} and host_id = ${userId}
      `;
    });
  }

  async lastRound(id: string): Promise<number> {
    const [row] = await this.sql<{ round: number }[]>`
      select coalesce(max(round), 0)::int as round from giveaways_winners where giveaway_id = ${id}
    `;
    return row?.round ?? 0;
  }
}
