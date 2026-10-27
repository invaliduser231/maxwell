import { connect, migrate, type Sql, silentLogger } from '@maxwell/core';
import definition, { type FeedsConfig, feedsConfig } from '@maxwell/core/modules/feeds';
import { FeedStore, mergeSeen } from '@maxwell/core/stores/feeds';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FeedPoller, PAUSE_AFTER } from '../../src/modules/feeds/poller.js';
import type { OutgoingMessage } from '../../src/platform/types.js';
import type { ModuleContext } from '../../src/runtime/module.js';

const url = process.env.TEST_DATABASE_URL;

function rss(ids: string[]): string {
  const items = ids
    .map(
      (id, index) =>
        `<item><title>Post ${id}</title><link>https://example.org/${id}</link><guid>${id}</guid>` +
        `<pubDate>${new Date(Date.now() - index * 60_000).toUTCString()}</pubDate></item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items}</channel></rss>`;
}

describe('mergeSeen', () => {
  it('keeps fresh ids first without duplicates', () => {
    expect(mergeSeen(['c', 'b'], ['b', 'a'])).toEqual(['c', 'b', 'a']);
  });
});

describe.skipIf(!url)('feeds store and poller', () => {
  let sql: Sql;
  let store: FeedStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const channel = '400000000000000001';
  let config: FeedsConfig = feedsConfig.parse({});
  let body = rss(['a', 'b']);
  let failing = false;
  const sent: { channelId: string; message: OutgoingMessage }[] = [];
  const scheduled: unknown[] = [];
  const records: unknown[][] = [];

  const ctx = {
    key: 'feeds',
    definition,
    services: {
      log: silentLogger,
      platform: {
        channelInGuild: async () => true,
        send: async (channelId: string, message: OutgoingMessage) => {
          sent.push({ channelId, message });
          return String(500000000000000000n + BigInt(sent.length));
        },
      },
    },
    config: async () => config,
    enabled: async () => true,
    schedule: async (_kind: string, input: unknown) => {
      scheduled.push(input);
      return String(scheduled.length);
    },
    record: async (...args: unknown[]) => {
      records.push(args);
      return '1';
    },
  } as unknown as ModuleContext<typeof feedsConfig>;

  const fetcher = async () =>
    failing ? new Response('', { status: 500 }) : new Response(body, { status: 200 });
  let poller: FeedPoller;

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, silentLogger, [{ module: 'feeds', migrations: definition.migrations }]);
    store = new FeedStore(sql);
    poller = new FeedPoller(ctx, store, {
      fetcher,
      checkUrl: async () => true,
      twitch: null,
      sharedTtl: 0,
    });
    config = feedsConfig.parse({
      feeds: [{ id: 'f1', type: 'rss', source: 'https://example.org/feed', channelId: channel }],
    });
  });

  afterAll(async () => {
    await sql`delete from feeds_state where guild_id = ${guild}`;
    await sql`delete from feeds_posts where guild_id = ${guild}`;
    await sql`delete from guild_modules where guild_id = ${guild}`;
    await sql`delete from guilds where id = ${guild}`;
    await sql.end();
  });

  it('keeps test outcomes per request and community', async () => {
    const requestId = `test-${guild}`;
    expect(await store.testOutcome(guild, requestId)).toBeNull();
    await store.recordTest(guild, 'f1', requestId, 'send_failed');
    expect(await store.testOutcome(guild, requestId)).toBe('send_failed');
    expect(await store.testOutcome('1', requestId)).toBeNull();
    await sql`delete from feeds_tests where request_id = ${requestId}`;
  });

  it('primes a new feed without posting the backlog', async () => {
    await poller.poll(guild, 'f1');
    expect(sent).toHaveLength(0);
    const state = await store.state(guild, 'f1');
    expect(state?.seen).toEqual(['a', 'b']);
    expect(state?.primedAt).toBeInstanceOf(Date);
  });

  it('posts only new items and remembers them', async () => {
    body = rss(['d', 'c', 'a', 'b']);
    await poller.poll(guild, 'f1');
    expect(sent.map((entry) => entry.message.embeds?.[0]?.title)).toEqual(['Post c', 'Post d']);
    const state = await store.state(guild, 'f1');
    expect(state?.seen.slice(0, 2)).toEqual(['d', 'c']);
    expect(state?.posted).toBe(2);
    const posts = await store.recentPosts(guild, 'f1');
    expect(posts.map((post) => post.itemId)).toEqual(['d', 'c']);

    await poller.poll(guild, 'f1');
    expect(sent).toHaveLength(2);
  });

  it('backs off and pauses a failing feed with an undo entry', async () => {
    failing = true;
    await sql`update feeds_state set failures = ${PAUSE_AFTER - 1} where guild_id = ${guild}`;
    await poller.poll(guild, 'f1');
    const state = await store.state(guild, 'f1');
    expect(state?.failures).toBe(PAUSE_AFTER);
    expect(state?.lastError).toBe('http');
    expect(state?.pausedAt).toBeInstanceOf(Date);
    expect(state && state.nextPollAt.getTime() > Date.now()).toBe(true);
    expect(records[0]?.[2]).toBe('feed.pause');
    expect(records[0]?.[4]).toMatchObject({ undo: { kind: 'resume', payload: { feedId: 'f1' } } });

    failing = false;
    expect(await poller.resume(guild, 'f1', null)).toBe(true);
    const resumed = await store.state(guild, 'f1');
    expect(resumed?.pausedAt).toBeNull();
    expect(resumed?.failures).toBe(0);
  });

  it('filters before the per check limit so older matches still post', async () => {
    config = feedsConfig.parse({
      feeds: [
        ...config.feeds,
        {
          id: 'f2',
          type: 'rss',
          source: 'https://example.org/filtered',
          channelId: channel,
          include: ['keep'],
        },
      ],
    });
    body = rss(['seed']);
    await poller.poll(guild, 'f2');
    const before = sent.length;
    body = rss(['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'keep1', 'keep2', 'seed']);
    await poller.poll(guild, 'f2');
    expect(sent.slice(before).map((entry) => entry.message.embeds?.[0]?.title)).toEqual([
      'Post keep2',
      'Post keep1',
    ]);
    const state = await store.state(guild, 'f2');
    expect(state?.seen).toContain('n1');
    config = feedsConfig.parse({ feeds: config.feeds.filter((feed) => feed.id !== 'f2') });
  });

  it('queues due feeds from the tick and forgets removed ones', async () => {
    await sql`insert into guilds (id) values (${guild}) on conflict do nothing`;
    await sql`
      insert into guild_modules (guild_id, module, enabled, config)
      values (${guild}, 'feeds', true, ${sql.json(config as never)})
      on conflict (guild_id, module) do update set enabled = true, config = excluded.config
    `;
    await sql`update feeds_state set next_poll_at = now() - interval '1 minute' where guild_id = ${guild}`;
    await sql`
      insert into feeds_state (guild_id, feed_id, source_key) values (${guild}, 'gone', 'rss:x')
    `;
    scheduled.length = 0;
    await poller.tick();
    expect(scheduled).toContainEqual({
      guildId: guild,
      payload: { feedId: 'f1' },
      dedupeKey: `feeds.poll:${guild}:f1`,
    });
    expect(await store.state(guild, 'gone')).toBeNull();
  });
});
