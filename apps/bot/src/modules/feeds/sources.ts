import { type FeedSource, resolveSource, youtubePage } from '@maxwell/core/modules/feeds';
import type { Config } from '../../config.js';
import { copy } from './copy.js';
import { type Fetcher, fetchText, USER_AGENT } from './http.js';
import { FeedError, type FeedItem, parseFeed } from './parse.js';

export {
  blueskyActor,
  FLUXER_BLOG_FEED,
  githubFeed,
  redditFeed,
  resolveSource,
  rssFeed,
  twitchLogin,
  youtubeFeed,
  youtubePage,
} from '@maxwell/core/modules/feeds';

export interface SourceResult {
  status: 'ok' | 'unchanged';
  items: FeedItem[];
  etag: string | null;
  lastModified: string | null;
}

export interface SourceDeps {
  fetcher?: Fetcher;
  checkUrl?: (url: string) => Promise<boolean>;
  twitch: TwitchClient | null;
}

export interface Cache {
  etag: string | null;
  lastModified: string | null;
}

const CHANNEL_TTL = 24 * 60 * 60_000;
const channelIds = new Map<string, { id: string; at: number }>();

export function channelIdFromPage(html: string): string | null {
  return (
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(
      html,
    )?.[1] ??
    /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1] ??
    /"externalChannelId":"(UC[\w-]{22})"/.exec(html)?.[1] ??
    null
  );
}

async function youtubeChannelFeed(page: string, deps: SourceDeps): Promise<string> {
  const cached = channelIds.get(page);
  let id = cached && Date.now() - cached.at < CHANNEL_TTL ? cached.id : null;
  if (!id) {
    const result = await fetchText(
      page,
      { accept: 'text/html', headers: { cookie: 'SOCS=CAI' } },
      deps.fetcher,
      deps.checkUrl,
    );
    id = channelIdFromPage(result.body);
    if (!id) throw new FeedError('invalid_source');
    if (channelIds.size > 5_000) channelIds.clear();
    channelIds.set(page, { id, at: Date.now() });
  }
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
}

export function sourceKey(feed: Pick<FeedSource, 'type' | 'source'>): string {
  return `${feed.type}:${resolveSource(feed.type, feed.source) ?? feed.source.trim()}`;
}

export function sourceLabel(feed: Pick<FeedSource, 'type' | 'source' | 'name'>): string {
  if (feed.name.trim()) return feed.name.trim();
  const resolved = resolveSource(feed.type, feed.source);
  switch (feed.type) {
    case 'reddit':
      return resolved ? `r/${/\/r\/([^/]+)/.exec(resolved)?.[1] ?? ''}` : copy.labels.reddit;
    case 'github':
      return resolved
        ? (/github\.com\/([^/]+\/[^/]+)\//.exec(resolved)?.[1] ?? copy.labels.github)
        : copy.labels.github;
    case 'bluesky':
      return resolved ? `@${resolved}` : copy.labels.bluesky;
    case 'twitch':
      return resolved ?? copy.labels.twitch;
    case 'fluxer':
      return copy.labels.fluxer;
    case 'youtube':
      return copy.labels.youtube;
    case 'rss':
      try {
        return new URL(feed.source).hostname;
      } catch {
        return copy.labels.rss;
      }
  }
}

interface BlueskyPost {
  uri?: string;
  author?: { handle?: string; displayName?: string };
  record?: { text?: string; createdAt?: string; reply?: unknown };
  embed?: {
    images?: { thumb?: string; fullsize?: string }[];
    external?: { thumb?: string; uri?: string; title?: string };
    media?: { images?: { thumb?: string; fullsize?: string }[] };
  };
}

interface BlueskyFeed {
  feed?: { post?: BlueskyPost; reason?: unknown; reply?: unknown }[];
}

export function blueskyItems(data: BlueskyFeed, reposts: boolean): FeedItem[] {
  const items: FeedItem[] = [];
  for (const entry of data.feed ?? []) {
    const post = entry.post;
    if (!post?.uri || !post.author?.handle) continue;
    if (entry.reason && !reposts) continue;
    if (post.record?.reply || entry.reply) continue;
    const rkey = post.uri.split('/').pop() ?? '';
    const body = (post.record?.text ?? '').trim();
    const firstLine = body.split('\n')[0] ?? '';
    const image =
      post.embed?.images?.[0]?.fullsize ??
      post.embed?.media?.images?.[0]?.fullsize ??
      post.embed?.external?.thumb ??
      null;
    const created = post.record?.createdAt ? new Date(post.record.createdAt) : null;
    items.push({
      id: post.uri,
      title:
        firstLine.length > 256 ? `${firstLine.slice(0, 255)}…` : firstLine || copy.untitledPost,
      url: `https://bsky.app/profile/${post.author.handle}/post/${rkey}`,
      summary: body.length > 600 ? `${body.slice(0, 599)}…` : body,
      author: post.author.displayName?.trim() || `@${post.author.handle}`,
      publishedAt: created && !Number.isNaN(created.getTime()) ? created : null,
      imageUrl: image,
    });
  }
  return items;
}

export interface TwitchCredentials {
  clientId: string;
  clientSecret: string;
}

export function twitchCredentials(
  config: Pick<Config, 'TWITCH_CLIENT_ID' | 'TWITCH_CLIENT_SECRET'>,
): TwitchCredentials | null {
  const clientId = config.TWITCH_CLIENT_ID?.trim();
  const clientSecret = config.TWITCH_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

interface TwitchStream {
  id: string;
  user_login: string;
  user_name: string;
  title: string;
  game_name?: string;
  thumbnail_url?: string;
  started_at?: string;
}

export class TwitchClient {
  #token: { value: string; until: number } | null = null;

  constructor(
    private readonly credentials: TwitchCredentials,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async #accessToken(): Promise<string> {
    if (this.#token && this.#token.until > Date.now()) return this.#token.value;
    const body = new URLSearchParams({
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      grant_type: 'client_credentials',
    });
    const response = await this.fetcher('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body,
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      throw new FeedError('unreachable');
    });
    if (!response.ok) throw new FeedError('twitch_auth', String(response.status));
    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new FeedError('twitch_auth');
    const ttl = Math.max((data.expires_in ?? 3600) - 300, 60) * 1000;
    this.#token = { value: data.access_token, until: Date.now() + ttl };
    return data.access_token;
  }

  async live(login: string): Promise<FeedItem[]> {
    const token = await this.#accessToken();
    const url = `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`;
    const result = await fetchText(
      url,
      {
        accept: 'application/json',
        headers: { 'client-id': this.credentials.clientId, authorization: `Bearer ${token}` },
      },
      this.fetcher,
      async () => true,
    ).catch((error: unknown) => {
      if (error instanceof FeedError && error.message.includes('401')) this.#token = null;
      throw error;
    });
    const data = JSON.parse(result.body) as { data?: TwitchStream[] };
    return (data.data ?? []).map((stream) => {
      const started = stream.started_at ? new Date(stream.started_at) : null;
      const thumb = stream.thumbnail_url
        ?.replace('{width}', '1280')
        .replace('{height}', '720')
        .concat(`?t=${encodeURIComponent(stream.id)}`);
      return {
        id: `stream:${stream.id}`,
        title: stream.title || copy.twitchUntitled,
        url: `https://www.twitch.tv/${stream.user_login}`,
        summary: stream.game_name ? copy.twitchPlaying(stream.game_name) : '',
        author: stream.user_name || stream.user_login,
        publishedAt: started && !Number.isNaN(started.getTime()) ? started : null,
        imageUrl: thumb ?? null,
      };
    });
  }
}

export async function loadSource(
  feed: FeedSource,
  cache: Cache,
  deps: SourceDeps,
): Promise<SourceResult> {
  let resolved = resolveSource(feed.type, feed.source);
  if (!resolved && feed.type === 'youtube') {
    const page = youtubePage(feed.source);
    if (page) resolved = await youtubeChannelFeed(page, deps);
  }
  if (!resolved) throw new FeedError('invalid_source');

  if (feed.type === 'twitch') {
    if (!deps.twitch) throw new FeedError('twitch_unconfigured');
    const items = await deps.twitch.live(resolved);
    return { status: 'ok', items, etag: null, lastModified: null };
  }

  if (feed.type === 'bluesky') {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(
      resolved,
    )}&limit=20&filter=posts_no_replies`;
    const result = await fetchText(
      url,
      { accept: 'application/json' },
      deps.fetcher,
      deps.checkUrl,
    );
    let data: BlueskyFeed;
    try {
      data = JSON.parse(result.body) as BlueskyFeed;
    } catch {
      throw new FeedError('not_a_feed');
    }
    return {
      status: 'ok',
      items: blueskyItems(data, feed.reposts),
      etag: null,
      lastModified: null,
    };
  }

  const result = await fetchText(resolved, cache, deps.fetcher, deps.checkUrl);
  if (result.status === 'unchanged') {
    return { status: 'unchanged', items: [], etag: result.etag, lastModified: result.lastModified };
  }
  let items = parseFeed(result.body).items;
  if (feed.type === 'youtube' && !feed.shorts) {
    items = items.filter((item) => !item.url?.includes('/shorts/'));
  }
  return { status: 'ok', items, etag: result.etag, lastModified: result.lastModified };
}
