import type { Sql } from '../db/sql.js';
import type { SuggestionStatus } from '../modules/suggestions.js';

export interface Suggestion {
  id: string;
  number: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  authorId: string | null;
  content: string;
  upEmoji: string;
  downEmoji: string;
  status: SuggestionStatus;
  reason: string | null;
  statusBy: string | null;
  statusAt: Date | null;
  up: number;
  down: number;
  createdAt: Date;
}

export interface SuggestionInput {
  guildId: string;
  channelId: string;
  authorId: string;
  content: string;
  upEmoji: string;
  downEmoji: string;
}

export interface Tally {
  up: number;
  down: number;
  previous: -1 | 1 | null;
}

export interface MemberVote {
  suggestionId: string;
  vote: -1 | 1;
  votedAt: Date;
}

export interface MemberSuggestions {
  authored: Suggestion[];
  votes: MemberVote[];
}

export interface StatusChange {
  before: { status: SuggestionStatus; reason: string | null };
  after: Suggestion;
}

export class SuggestionStore {
  constructor(private readonly sql: Sql) {}

  #columns() {
    return this.sql`
      id::text as id, number, guild_id::text as "guildId", channel_id::text as "channelId",
      message_id::text as "messageId", author_id::text as "authorId", content,
      up_emoji as "upEmoji", down_emoji as "downEmoji", status, reason,
      status_by::text as "statusBy", status_at as "statusAt", up, down, created_at as "createdAt"
    `;
  }

  async create(input: SuggestionInput): Promise<Suggestion> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`suggestions:${input.guildId}`}))`;
      const [row] = await tx<Suggestion[]>`
        insert into suggestions_items (
          guild_id, number, channel_id, author_id, content, up_emoji, down_emoji
        )
        values (
          ${input.guildId},
          (select coalesce(max(number), 0) + 1 from suggestions_items where guild_id = ${input.guildId}),
          ${input.channelId}, ${input.authorId}, ${input.content},
          ${input.upEmoji}, ${input.downEmoji}
        )
        returning ${this.#columns()}
      `;
      if (!row) throw new Error('suggestion insert returned nothing');
      return row;
    });
  }

  async attach(id: string, messageId: string): Promise<void> {
    await this.sql`update suggestions_items set message_id = ${messageId} where id = ${id}`;
  }

  async discard(id: string): Promise<void> {
    await this.sql`delete from suggestions_items where id = ${id}`;
  }

  async get(guildId: string, id: string): Promise<Suggestion | null> {
    if (!/^\d{1,19}$/.test(id)) return null;
    const [row] = await this.sql<Suggestion[]>`
      select ${this.#columns()} from suggestions_items where guild_id = ${guildId} and id = ${id}
    `;
    return row ?? null;
  }

  async byMessage(messageId: string): Promise<Suggestion | null> {
    const [row] = await this.sql<Suggestion[]>`
      select ${this.#columns()} from suggestions_items where message_id = ${messageId}
    `;
    return row ?? null;
  }

  async list(
    guildId: string,
    options: { status?: SuggestionStatus; limit?: number; before?: string } = {},
  ): Promise<Suggestion[]> {
    return this.sql<Suggestion[]>`
      select ${this.#columns()} from suggestions_items
      where guild_id = ${guildId}
        ${options.status ? this.sql`and status = ${options.status}` : this.sql``}
        ${options.before ? this.sql`and id < ${options.before}` : this.sql``}
      order by id desc
      limit ${Math.min(Math.max(options.limit ?? 25, 1), 100)}
    `;
  }

  async top(
    guildId: string,
    options: { status?: SuggestionStatus; limit?: number; offset?: number } = {},
  ): Promise<Suggestion[]> {
    return this.sql<Suggestion[]>`
      select ${this.#columns()} from suggestions_items
      where guild_id = ${guildId}
        ${options.status ? this.sql`and status = ${options.status}` : this.sql``}
      order by (up - down) desc, up desc, id desc
      limit ${Math.min(Math.max(options.limit ?? 10, 1), 100)}
      offset ${Math.max(Math.floor(options.offset ?? 0), 0)}
    `;
  }

  async counts(guildId: string): Promise<Record<SuggestionStatus, number>> {
    const rows = await this.sql<{ status: SuggestionStatus; count: number }[]>`
      select status, count(*)::int as count from suggestions_items
      where guild_id = ${guildId} group by status
    `;
    const out: Record<SuggestionStatus, number> = { open: 0, planned: 0, done: 0, declined: 0 };
    for (const row of rows) out[row.status] = row.count;
    return out;
  }

  async vote(id: string, userId: string, vote: -1 | 1): Promise<Tally> {
    return this.sql.begin(async (tx) => {
      const [prev] = await tx<{ vote: -1 | 1 }[]>`
        select vote from suggestions_votes
        where suggestion_id = ${id} and user_id = ${userId}
        for update
      `;
      await tx`
        insert into suggestions_votes (suggestion_id, user_id, vote)
        values (${id}, ${userId}, ${vote})
        on conflict (suggestion_id, user_id) do update set vote = excluded.vote, voted_at = now()
      `;
      const tally = await this.#recount(tx as unknown as Sql, id);
      return { ...tally, previous: prev?.vote ?? null };
    });
  }

  async unvote(id: string, userId: string, vote: -1 | 1): Promise<Tally> {
    return this.sql.begin(async (tx) => {
      const removed = await tx`
        delete from suggestions_votes
        where suggestion_id = ${id} and user_id = ${userId} and vote = ${vote}
        returning vote
      `;
      const tally = await this.#recount(tx as unknown as Sql, id);
      return { ...tally, previous: removed.length > 0 ? vote : null };
    });
  }

  async memberData(guildId: string, userId: string): Promise<MemberSuggestions> {
    const [authored, votes] = await Promise.all([
      this.sql<Suggestion[]>`
        select ${this.#columns()} from suggestions_items
        where guild_id = ${guildId} and author_id = ${userId}
        order by id
      `,
      this.sql<MemberVote[]>`
        select v.suggestion_id::text as "suggestionId", v.vote, v.voted_at as "votedAt"
        from suggestions_votes v join suggestions_items s on s.id = v.suggestion_id
        where s.guild_id = ${guildId} and v.user_id = ${userId}
        order by v.voted_at
      `,
    ]);
    return { authored, votes };
  }

  async forget(guildId: string, userId: string): Promise<Suggestion[]> {
    return this.sql.begin(async (tx) => {
      const voted = await tx<{ id: string }[]>`
        delete from suggestions_votes v using suggestions_items s
        where s.id = v.suggestion_id and s.guild_id = ${guildId} and v.user_id = ${userId}
        returning s.id::text as id
      `;
      for (const { id } of voted) await this.#recount(tx as unknown as Sql, id);
      await tx`
        update suggestions_items set status_by = null
        where guild_id = ${guildId} and status_by = ${userId}
      `;
      return tx<Suggestion[]>`
        update suggestions_items set author_id = null
        where guild_id = ${guildId} and author_id = ${userId}
        returning ${this.#columns()}
      `;
    });
  }

  async #recount(sql: Sql, id: string): Promise<{ up: number; down: number }> {
    const [row] = await sql<{ up: number; down: number }[]>`
      update suggestions_items set
        up = (select count(*) from suggestions_votes where suggestion_id = ${id} and vote = 1),
        down = (select count(*) from suggestions_votes where suggestion_id = ${id} and vote = -1)
      where id = ${id}
      returning up, down
    `;
    return { up: row?.up ?? 0, down: row?.down ?? 0 };
  }

  async setStatus(
    guildId: string,
    id: string,
    status: SuggestionStatus,
    reason: string | null,
    by: string | null,
  ): Promise<StatusChange | null> {
    return this.sql.begin(async (tx) => {
      const [before] = await tx<{ status: SuggestionStatus; reason: string | null }[]>`
        select status, reason from suggestions_items
        where guild_id = ${guildId} and id = ${id}
        for update
      `;
      if (!before) return null;
      const [after] = await tx<Suggestion[]>`
        update suggestions_items set
          status = ${status}, reason = ${reason}, status_by = ${by}, status_at = now()
        where guild_id = ${guildId} and id = ${id}
        returning ${this.#columns()}
      `;
      if (!after) return null;
      return { before, after };
    });
  }
}
