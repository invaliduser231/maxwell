import type { Sql } from '../db/sql.js';

export const SEEN_LIMIT = 300;
export const POSTS_KEPT = 50;

export interface FeedState {
  guildId: string;
  feedId: string;
  sourceKey: string;
  seen: string[];
  etag: string | null;
  lastModified: string | null;
  primedAt: Date | null;
  lastPolledAt: Date | null;
  nextPollAt: Date;
  lastItemAt: Date | null;
  lastPostedAt: Date | null;
  failures: number;
  lastError: string | null;
  pausedAt: Date | null;
  posted: number;
}

export interface FeedPost {
  id: string;
  guildId: string;
  feedId: string;
  itemId: string;
  title: string;
  url: string | null;
  channelId: string;
  messageId: string | null;
  postedAt: Date;
}

export interface FeedPostInput {
  itemId: string;
  title: string;
  url: string | null;
  channelId: string;
  messageId: string | null;
}

export interface FeedSchedule {
  guildId: string;
  feedId: string;
  sourceKey: string;
  nextPollAt: Date;
  pausedAt: Date | null;
}

export interface FeedGuild {
  guildId: string;
  config: unknown;
}

export interface PollOutcome {
  sourceKey: string;
  seen: string[];
  etag: string | null;
  lastModified: string | null;
  primed: boolean;
  nextPollAt: Date;
  lastItemAt: Date | null;
  posted: number;
}

export function mergeSeen(fresh: readonly string[], previous: readonly string[]): string[] {
  const out: string[] = [];
  const known = new Set<string>();
  for (const id of [...fresh, ...previous]) {
    if (known.has(id)) continue;
    known.add(id);
    out.push(id);
    if (out.length >= SEEN_LIMIT) break;
  }
  return out;
}

const columns = (sql: Sql) => sql`
  guild_id as "guildId", feed_id as "feedId", source_key as "sourceKey", seen, etag,
  last_modified as "lastModified", primed_at as "primedAt", last_polled_at as "lastPolledAt",
  next_poll_at as "nextPollAt", last_item_at as "lastItemAt", last_posted_at as "lastPostedAt",
  failures, last_error as "lastError", paused_at as "pausedAt", posted
`;

export class FeedStore {
  constructor(private readonly sql: Sql) {}

  async enabledGuilds(): Promise<FeedGuild[]> {
    return this.sql<FeedGuild[]>`
      select m.guild_id as "guildId", m.config
      from guild_modules m
      join guilds g on g.id = m.guild_id
      where m.module = 'feeds' and m.enabled is true and g.left_at is null
    `;
  }

  async schedule(): Promise<FeedSchedule[]> {
    return this.sql<FeedSchedule[]>`
      select guild_id as "guildId", feed_id as "feedId", source_key as "sourceKey",
        next_poll_at as "nextPollAt", paused_at as "pausedAt"
      from feeds_state
    `;
  }

  async states(guildId: string): Promise<FeedState[]> {
    return this.sql<FeedState[]>`
      select ${columns(this.sql)} from feeds_state where guild_id = ${guildId}
    `;
  }

  async state(guildId: string, feedId: string): Promise<FeedState | null> {
    const [row] = await this.sql<FeedState[]>`
      select ${columns(this.sql)} from feeds_state
      where guild_id = ${guildId} and feed_id = ${feedId}
    `;
    return row ?? null;
  }

  async saveOutcome(guildId: string, feedId: string, outcome: PollOutcome): Promise<void> {
    const seen = outcome.seen.slice(0, SEEN_LIMIT);
    await this.sql`
      insert into feeds_state (
        guild_id, feed_id, source_key, seen, etag, last_modified, primed_at, last_polled_at,
        next_poll_at, last_item_at, last_posted_at, failures, last_error, posted
      ) values (
        ${guildId}, ${feedId}, ${outcome.sourceKey}, ${this.sql.array(seen)}::text[],
        ${outcome.etag}, ${outcome.lastModified}, ${outcome.primed ? new Date() : null}, now(),
        ${outcome.nextPollAt}, ${outcome.lastItemAt},
        ${outcome.posted > 0 ? new Date() : null}, 0, null, ${outcome.posted}
      )
      on conflict (guild_id, feed_id) do update set
        source_key = excluded.source_key,
        seen = excluded.seen,
        etag = excluded.etag,
        last_modified = excluded.last_modified,
        primed_at = case when ${outcome.primed} then now() else feeds_state.primed_at end,
        last_polled_at = now(),
        next_poll_at = excluded.next_poll_at,
        last_item_at = coalesce(excluded.last_item_at, feeds_state.last_item_at),
        last_posted_at = coalesce(excluded.last_posted_at, feeds_state.last_posted_at),
        failures = 0,
        last_error = null,
        posted = feeds_state.posted + excluded.posted
    `;
  }

  async touch(guildId: string, feedId: string, sourceKey: string, nextPollAt: Date): Promise<void> {
    await this.sql`
      insert into feeds_state (guild_id, feed_id, source_key, last_polled_at, next_poll_at)
      values (${guildId}, ${feedId}, ${sourceKey}, now(), ${nextPollAt})
      on conflict (guild_id, feed_id) do update set
        last_polled_at = now(), next_poll_at = excluded.next_poll_at, failures = 0, last_error = null
    `;
  }

  async fail(
    guildId: string,
    feedId: string,
    sourceKey: string,
    error: string,
    nextPollAt: Date,
  ): Promise<number> {
    const [row] = await this.sql<{ failures: number }[]>`
      insert into feeds_state (
        guild_id, feed_id, source_key, last_polled_at, next_poll_at, failures, last_error
      ) values (${guildId}, ${feedId}, ${sourceKey}, now(), ${nextPollAt}, 1, ${error.slice(0, 500)})
      on conflict (guild_id, feed_id) do update set
        last_polled_at = now(),
        next_poll_at = excluded.next_poll_at,
        failures = feeds_state.failures + 1,
        last_error = excluded.last_error
      returning failures
    `;
    return row?.failures ?? 1;
  }

  async pause(guildId: string, feedId: string): Promise<boolean> {
    const rows = await this.sql`
      update feeds_state set paused_at = now()
      where guild_id = ${guildId} and feed_id = ${feedId} and paused_at is null
      returning feed_id
    `;
    return rows.length > 0;
  }

  async resume(guildId: string, feedId: string): Promise<boolean> {
    const rows = await this.sql`
      update feeds_state set paused_at = null, failures = 0, last_error = null, next_poll_at = now()
      where guild_id = ${guildId} and feed_id = ${feedId}
      returning feed_id
    `;
    return rows.length > 0;
  }

  async forget(guildId: string, keep: readonly string[]): Promise<number> {
    const ids = [...keep];
    const rows = await this.sql`
      delete from feeds_state
      where guild_id = ${guildId} and not (feed_id = any(${this.sql.array(ids)}::text[]))
      returning feed_id
    `;
    await this.sql`
      delete from feeds_posts
      where guild_id = ${guildId} and not (feed_id = any(${this.sql.array(ids)}::text[]))
    `;
    return rows.length;
  }

  async recordPosts(
    guildId: string,
    feedId: string,
    posts: readonly FeedPostInput[],
  ): Promise<void> {
    if (posts.length === 0) return;
    const rows = posts.map((post) => ({
      guild_id: guildId,
      feed_id: feedId,
      item_id: post.itemId,
      title: post.title.slice(0, 300),
      url: post.url,
      channel_id: post.channelId,
      message_id: post.messageId,
    }));
    await this.sql`insert into feeds_posts ${this.sql(rows)}`;
    await this.sql`
      delete from feeds_posts
      where guild_id = ${guildId} and feed_id = ${feedId} and id not in (
        select id from feeds_posts
        where guild_id = ${guildId} and feed_id = ${feedId}
        order by posted_at desc, id desc
        limit ${POSTS_KEPT}
      )
    `;
  }

  async recordTest(
    guildId: string,
    feedId: string,
    requestId: string,
    outcome: string,
  ): Promise<void> {
    await this.sql`
      insert into feeds_tests (request_id, guild_id, feed_id, outcome)
      values (${requestId}, ${guildId}, ${feedId}, ${outcome.slice(0, 64)})
      on conflict (request_id) do update set outcome = excluded.outcome
    `;
    await this.sql`delete from feeds_tests where created_at < now() - interval '1 hour'`;
  }

  async testOutcome(guildId: string, requestId: string): Promise<string | null> {
    const [row] = await this.sql<{ outcome: string }[]>`
      select outcome from feeds_tests where request_id = ${requestId} and guild_id = ${guildId}
    `;
    return row?.outcome ?? null;
  }

  async recentPosts(guildId: string, feedId?: string, limit = 20): Promise<FeedPost[]> {
    const size = Math.min(Math.max(limit, 1), 100);
    return this.sql<FeedPost[]>`
      select id, guild_id as "guildId", feed_id as "feedId", item_id as "itemId", title, url,
        channel_id as "channelId", message_id as "messageId", posted_at as "postedAt"
      from feeds_posts
      where guild_id = ${guildId} ${feedId ? this.sql`and feed_id = ${feedId}` : this.sql``}
      order by posted_at desc, id desc
      limit ${size}
    `;
  }
}
