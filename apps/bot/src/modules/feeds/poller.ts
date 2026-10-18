import { type Actor, maxwell } from '@maxwell/core';
import type { FeedSource, feedsConfig } from '@maxwell/core/modules/feeds';
import { type FeedPostInput, type FeedStore, mergeSeen } from '@maxwell/core/stores/feeds';
import type { ModuleContext } from '../../runtime/module.js';
import { audit } from './copy.js';
import { FeedError, type FeedItem } from './parse.js';
import { backoff, buildPost, passesFilters, selectNew } from './render.js';
import { loadSource, type SourceDeps, sourceKey, sourceLabel } from './sources.js';

export const PAUSE_AFTER = 10;
const UNPAUSABLE = new Set(['twitch_unconfigured']);
const TICK_LIMIT = 1_000;

type Ctx = ModuleContext<typeof feedsConfig>;

export function errorCode(error: unknown): string {
  if (error instanceof FeedError) return error.code;
  return 'unreachable';
}

function newest(items: readonly FeedItem[]): Date | null {
  let best: number | null = null;
  for (const item of items) {
    const at = item.publishedAt?.getTime();
    if (at !== undefined && (best === null || at > best)) best = at;
  }
  return best === null ? null : new Date(best);
}

export class FeedPoller {
  constructor(
    private readonly ctx: Ctx,
    private readonly store: FeedStore,
    private readonly sources: SourceDeps,
  ) {}

  async tick(now = new Date()): Promise<number> {
    const [guilds, schedule] = await Promise.all([
      this.store.enabledGuilds(),
      this.store.schedule(),
    ]);
    const states = new Map(schedule.map((row) => [`${row.guildId}:${row.feedId}`, row]));
    const known = new Map<string, Set<string>>();
    for (const row of schedule) {
      const set = known.get(row.guildId) ?? new Set<string>();
      set.add(row.feedId);
      known.set(row.guildId, set);
    }

    let queued = 0;
    for (const { guildId, config } of guilds) {
      const parsed = this.ctx.definition.config.safeParse(config ?? {});
      if (!parsed.success) continue;
      const feeds = parsed.data.feeds;
      const ids = new Set(feeds.map((feed) => feed.id));
      const stale = [...(known.get(guildId) ?? [])].some((id) => !ids.has(id));
      if (stale) await this.store.forget(guildId, [...ids]);

      for (const feed of feeds) {
        if (queued >= TICK_LIMIT) return queued;
        if (!feed.enabled || !feed.channelId) continue;
        const state = states.get(`${guildId}:${feed.id}`);
        const moved = !state || state.sourceKey !== sourceKey(feed);
        if (!moved && (state.pausedAt || state.nextPollAt > now)) continue;
        const id = await this.ctx.schedule('poll', {
          guildId,
          payload: { feedId: feed.id },
          dedupeKey: `feeds.poll:${guildId}:${feed.id}`,
        });
        if (id) queued++;
      }
    }
    return queued;
  }

  async #find(guildId: string, feedId: string): Promise<FeedSource | null> {
    const config = await this.ctx.config(guildId);
    return config.feeds.find((feed) => feed.id === feedId) ?? null;
  }

  async poll(guildId: string, feedId: string, force = false): Promise<void> {
    if (!(await this.ctx.enabled(guildId))) return;
    const feed = await this.#find(guildId, feedId);
    if (!feed?.enabled) return;

    const { log } = this.ctx.services;
    const key = sourceKey(feed);
    const state = await this.store.state(guildId, feedId);
    const fresh = !state || state.sourceKey !== key || !state.primedAt;
    if (state?.pausedAt && !fresh && !force) return;
    if (state?.pausedAt && force) await this.store.resume(guildId, feedId);

    const label = sourceLabel(feed);
    const interval = feed.interval * 60_000;
    let result: Awaited<ReturnType<typeof loadSource>>;
    try {
      result = await loadSource(
        feed,
        fresh
          ? { etag: null, lastModified: null }
          : { etag: state.etag, lastModified: state.lastModified },
        this.sources,
      );
    } catch (error) {
      const code = errorCode(error);
      if (!(error instanceof FeedError)) {
        log.warn({ err: error, guild: guildId, feed: feedId }, 'feed poll crashed');
      }
      await this.#failed(guildId, feed, key, label, code, (state?.failures ?? 0) + 1);
      return;
    }

    const next = new Date(Date.now() + interval);
    if (result.status === 'unchanged') {
      await this.store.touch(guildId, feedId, key, next);
      return;
    }

    const ids = result.items.map((item) => item.id);
    if (fresh) {
      await this.store.saveOutcome(guildId, feedId, {
        sourceKey: key,
        seen: mergeSeen(ids, []),
        etag: result.etag,
        lastModified: result.lastModified,
        primed: true,
        nextPollAt: next,
        lastItemAt: newest(result.items),
        posted: 0,
      });
      return;
    }

    const selection = selectNew(result.items, new Set(state.seen), state.primedAt);
    const wanted = selection.post.filter((item) => passesFilters(item, feed.include, feed.exclude));
    const delivered = await this.#deliver(guildId, feed, label, wanted);

    await this.store.saveOutcome(guildId, feedId, {
      sourceKey: key,
      seen: mergeSeen(ids, state.seen),
      etag: result.etag,
      lastModified: result.lastModified,
      primed: false,
      nextPollAt: next,
      lastItemAt: newest(result.items),
      posted: delivered.posted.length,
    });
    if (delivered.posted.length) {
      await this.store.recordPosts(guildId, feedId, delivered.posted);
    }
    if (delivered.error) {
      await this.#failed(guildId, feed, key, label, delivered.error, 1, next);
    }
  }

  async #deliver(
    guildId: string,
    feed: FeedSource,
    label: string,
    items: readonly FeedItem[],
  ): Promise<{ posted: FeedPostInput[]; error: string | null }> {
    const posted: FeedPostInput[] = [];
    if (items.length === 0) return { posted, error: null };
    const { platform, log } = this.ctx.services;
    const channelId = feed.channelId;
    if (!channelId) return { posted, error: 'no_channel' };
    if (!(await platform.channelInGuild(guildId, channelId).catch(() => false))) {
      return { posted, error: 'no_channel' };
    }
    for (const item of items) {
      try {
        const messageId = await platform.send(channelId, buildPost(feed, item, label));
        posted.push({ itemId: item.id, title: item.title, url: item.url, channelId, messageId });
      } catch (error) {
        log.warn({ err: error, guild: guildId, feed: feed.id }, 'feed post failed');
        return { posted, error: 'send_failed' };
      }
    }
    return { posted, error: null };
  }

  async #failed(
    guildId: string,
    feed: FeedSource,
    key: string,
    label: string,
    code: string,
    attempt: number,
    at?: Date,
  ): Promise<void> {
    const delay =
      code === 'twitch_unconfigured' ? 6 * 60 * 60 * 1000 : backoff(feed.interval, attempt);
    const next = at ?? new Date(Date.now() + delay);
    const failures = await this.store.fail(guildId, feed.id, key, code, next);
    if (failures < PAUSE_AFTER || UNPAUSABLE.has(code)) return;
    if (!(await this.store.pause(guildId, feed.id))) return;
    await this.ctx.record(
      guildId,
      maxwell,
      'feed.pause',
      audit.pausedSummary(label, audit.errors[code] ?? code),
      {
        before: { feedId: feed.id, paused: false },
        after: { feedId: feed.id, paused: true, error: code },
        undo: { kind: 'resume', payload: { feedId: feed.id } },
      },
    );
  }

  async test(guildId: string, feedId: string): Promise<'posted' | 'empty' | 'missing' | string> {
    const feed = await this.#find(guildId, feedId);
    if (!feed) return 'missing';
    if (!feed.channelId) return 'no_channel';
    let items: FeedItem[];
    try {
      items = (await loadSource(feed, { etag: null, lastModified: null }, this.sources)).items;
    } catch (error) {
      return errorCode(error);
    }
    const latest = [...items].sort(
      (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
    )[0];
    if (!latest) return 'empty';
    const delivered = await this.#deliver(guildId, feed, sourceLabel(feed), [latest]);
    return delivered.error ?? 'posted';
  }

  async resume(guildId: string, feedId: string, actor: Actor | null): Promise<boolean> {
    const resumed = await this.store.resume(guildId, feedId);
    if (!resumed || !actor) return resumed;
    const feed = await this.#find(guildId, feedId);
    await this.ctx.record(
      guildId,
      actor,
      'feed.resume',
      audit.resumedSummary(feed ? sourceLabel(feed) : feedId),
      { before: { feedId, paused: true }, after: { feedId, paused: false } },
    );
    return true;
  }
}
