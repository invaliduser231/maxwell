import { feedsConfig } from '@maxwell/core/modules/feeds';
import { describe, expect, it } from 'vitest';
import { fetchText } from '../../src/modules/feeds/http.js';
import { FeedError, type FeedItem } from '../../src/modules/feeds/parse.js';
import {
  backoff,
  buildPost,
  passesFilters,
  renderTemplate,
  selectNew,
} from '../../src/modules/feeds/render.js';
import {
  blueskyActor,
  blueskyItems,
  channelIdFromPage,
  githubFeed,
  loadSource,
  redditFeed,
  sourceKey,
  sourceLabel,
  twitchCredentials,
  twitchLogin,
  youtubeFeed,
  youtubePage,
} from '../../src/modules/feeds/sources.js';

const feed = (patch: Record<string, unknown>) =>
  feedsConfig.parse({ feeds: [{ id: 'f1', ...patch }] }).feeds[0] as NonNullable<
    ReturnType<typeof feedsConfig.parse>['feeds'][number]
  >;

const item = (id: string, minutes: number | null, patch: Partial<FeedItem> = {}): FeedItem => ({
  id,
  title: `Item ${id}`,
  url: `https://example.org/${id}`,
  summary: 'summary',
  author: null,
  publishedAt: minutes === null ? null : new Date(Date.UTC(2026, 9, 21, 12, minutes)),
  imageUrl: null,
  ...patch,
});

describe('source resolution', () => {
  it('accepts YouTube channel ids and urls', () => {
    const id = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
    const expected = `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
    expect(youtubeFeed(id)).toBe(expected);
    expect(youtubeFeed(`https://www.youtube.com/channel/${id}`)).toBe(expected);
    expect(youtubeFeed('https://www.youtube.com/@handle')).toBeNull();
    expect(youtubeFeed('https://evil.example/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw')).toBeNull();
  });

  it('finds the channel page for handles and custom urls', () => {
    expect(youtubePage('https://www.youtube.com/@LetsHugoGaming')).toBe(
      'https://www.youtube.com/@LetsHugoGaming',
    );
    expect(youtubePage('https://youtube.com/@LetsHugoGaming/videos')).toBe(
      'https://www.youtube.com/@LetsHugoGaming',
    );
    expect(youtubePage('@LetsHugoGaming')).toBe('https://www.youtube.com/@LetsHugoGaming');
    expect(youtubePage('https://www.youtube.com/c/Something')).toBe(
      'https://www.youtube.com/c/Something',
    );
    expect(youtubePage('https://evil.example/@handle')).toBeNull();
    expect(youtubePage('plain words')).toBeNull();
  });

  it('reads the channel id from a channel page', () => {
    const id = 'UCfDLplO_xeVw-E-oPEmGCQg';
    expect(
      channelIdFromPage(`<link rel="canonical" href="https://www.youtube.com/channel/${id}">`),
    ).toBe(id);
    expect(channelIdFromPage(`{"externalId":"${id}"}`)).toBe(id);
    expect(channelIdFromPage('<html></html>')).toBeNull();
  });

  it('loads a YouTube feed from a handle with the consent cookie', async () => {
    const id = 'UCfDLplO_xeVw-E-oPEmGCQg';
    const calls: { url: string; cookie: string | undefined }[] = [];
    const fetcher = async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ url, cookie: headers.cookie });
      if (url.includes('/@')) {
        return new Response(`<link rel="canonical" href="https://www.youtube.com/channel/${id}">`);
      }
      return new Response(
        '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>yt:video:6LptNMjDIWc</id><title>New</title><link href="https://www.youtube.com/watch?v=6LptNMjDIWc"/><published>2026-10-22T09:00:18+00:00</published></entry></feed>',
      );
    };
    const result = await loadSource(
      feed({ type: 'youtube', source: 'https://www.youtube.com/@HandleOnlyTest' }),
      { etag: null, lastModified: null },
      { twitch: null, fetcher, checkUrl: async () => true },
    );
    expect(calls[0]).toEqual({
      url: 'https://www.youtube.com/@HandleOnlyTest',
      cookie: 'SOCS=CAI',
    });
    expect(calls[1]?.url).toBe(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
    expect(result.items[0]?.url).toBe('https://www.youtube.com/watch?v=6LptNMjDIWc');
  });

  it('accepts subreddit names in several shapes', () => {
    const expected = 'https://www.reddit.com/r/programming/new/.rss';
    expect(redditFeed('programming')).toBe(expected);
    expect(redditFeed('r/programming')).toBe(expected);
    expect(redditFeed('https://www.reddit.com/r/programming/top')).toBe(expected);
    expect(redditFeed('no spaces allowed')).toBeNull();
  });

  it('builds GitHub release feeds', () => {
    const expected = 'https://github.com/nodejs/node/releases.atom';
    expect(githubFeed('nodejs/node')).toBe(expected);
    expect(githubFeed('https://github.com/nodejs/node.git')).toBe(expected);
    expect(githubFeed('nodejs')).toBeNull();
  });

  it('reads Bluesky handles and Twitch logins', () => {
    expect(blueskyActor('@bsky.app')).toBe('bsky.app');
    expect(blueskyActor('https://bsky.app/profile/jay.bsky.team')).toBe('jay.bsky.team');
    expect(blueskyActor('not a handle')).toBeNull();
    expect(twitchLogin('https://www.twitch.tv/Some_Streamer')).toBe('some_streamer');
    expect(twitchLogin('x')).toBeNull();
  });

  it('keys and labels sources', () => {
    expect(sourceKey(feed({ type: 'reddit', source: 'r/rust' }))).toBe(
      'reddit:https://www.reddit.com/r/rust/new/.rss',
    );
    expect(sourceLabel(feed({ type: 'reddit', source: 'rust' }))).toBe('r/rust');
    expect(sourceLabel(feed({ type: 'github', source: 'nodejs/node' }))).toBe('nodejs/node');
    expect(sourceLabel(feed({ type: 'rss', source: 'https://blog.example.org/feed' }))).toBe(
      'blog.example.org',
    );
    expect(sourceLabel(feed({ type: 'rss', name: 'Team news' }))).toBe('Team news');
  });

  it('only enables Twitch with both credentials', () => {
    expect(twitchCredentials({})).toBeNull();
    expect(twitchCredentials({ TWITCH_CLIENT_ID: 'a' })).toBeNull();
    expect(twitchCredentials({ TWITCH_CLIENT_ID: ' a ', TWITCH_CLIENT_SECRET: '  ' })).toBeNull();
    expect(twitchCredentials({ TWITCH_CLIENT_ID: 'a', TWITCH_CLIENT_SECRET: 'b' })).toEqual({
      clientId: 'a',
      clientSecret: 'b',
    });
  });

  it('refuses Twitch feeds without a client', async () => {
    await expect(
      loadSource(
        feed({ type: 'twitch', source: 'streamer' }),
        { etag: null, lastModified: null },
        {
          twitch: null,
        },
      ),
    ).rejects.toMatchObject({ code: 'twitch_unconfigured' });
  });
});

describe('bluesky', () => {
  const data = {
    feed: [
      {
        post: {
          uri: 'at://did:plc:abc/app.bsky.feed.post/3abc',
          author: { handle: 'jay.bsky.team', displayName: 'Jay' },
          record: { text: 'Hello there\nsecond line', createdAt: '2026-10-21T14:42:28.502Z' },
          embed: { images: [{ fullsize: 'https://cdn.bsky.app/img/1.jpg' }] },
        },
      },
      {
        post: {
          uri: 'at://did:plc:abc/app.bsky.feed.post/3rep',
          author: { handle: 'other.bsky.social' },
          record: { text: 'reposted', createdAt: '2026-10-21T10:00:00Z' },
        },
        reason: { $type: 'app.bsky.feed.defs#reasonRepost' },
      },
      {
        post: {
          uri: 'at://did:plc:abc/app.bsky.feed.post/3rpl',
          author: { handle: 'jay.bsky.team' },
          record: { text: 'a reply', reply: { parent: {} } },
        },
      },
    ],
  };

  it('maps posts and skips reposts and replies', () => {
    const items = blueskyItems(data, false);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'at://did:plc:abc/app.bsky.feed.post/3abc',
      title: 'Hello there',
      url: 'https://bsky.app/profile/jay.bsky.team/post/3abc',
      author: 'Jay',
      imageUrl: 'https://cdn.bsky.app/img/1.jpg',
    });
    expect(blueskyItems(data, true)).toHaveLength(2);
  });
});

describe('filters and templates', () => {
  it('applies include and exclude keywords', () => {
    const release = item('a', 1, { title: 'Release 2.0 beta', summary: 'New things' });
    expect(passesFilters(release, [], [])).toBe(true);
    expect(passesFilters(release, ['release'], [])).toBe(true);
    expect(passesFilters(release, ['stable'], [])).toBe(false);
    expect(passesFilters(release, ['release'], ['BETA'])).toBe(false);
  });

  it('fills known variables and keeps unknown ones', () => {
    expect(renderTemplate('{title} by {author} {nope}', { title: 'T', author: 'A' })).toBe(
      'T by A {nope}',
    );
  });

  it('builds a post with ping and embed', () => {
    const message = buildPost(
      feed({ type: 'github', source: 'nodejs/node', pingRoleId: '123456789012345678' }),
      item('a', 5, { title: 'v26.12.1' }),
      'nodejs/node',
    );
    expect(message.content).toBe('<@&123456789012345678>');
    expect(message.mentionRoles).toEqual(['123456789012345678']);
    expect(message.embeds?.[0]).toMatchObject({
      title: 'v26.12.1',
      url: 'https://example.org/a',
      footer: 'nodejs/node / GitHub releases',
    });
  });

  it('falls back to the default template without embeds', () => {
    const message = buildPost(
      feed({ type: 'reddit', source: 'rust', embed: false }),
      item('a', 5, { title: 'Hello' }),
      'r/rust',
    );
    expect(message.content).toBe('New in r/rust: **Hello**\nhttps://example.org/a');
    expect(message.embeds).toBeUndefined();
  });
});

describe('selectNew', () => {
  const primed = new Date(Date.UTC(2026, 9, 21, 12, 0));

  it('posts unseen items oldest first and caps the batch', () => {
    const items = [item('e', 50), item('d', 40), item('c', 30), item('b', 20), item('a', 10)];
    const result = selectNew(items, new Set(['a']), primed, 2);
    expect(result.post.map((entry) => entry.id)).toEqual(['d', 'e']);
    expect(result.skipped).toBe(2);
  });

  it('keeps feed order for undated items', () => {
    const items = [item('z', null), item('y', null)];
    expect(selectNew(items, new Set(), primed).post.map((entry) => entry.id)).toEqual(['y', 'z']);
  });

  it('skips items far older than the first poll', () => {
    const old = item('old', null, { publishedAt: new Date(Date.UTC(2026, 9, 1)) });
    expect(selectNew([old], new Set(), primed).post).toEqual([]);
  });

  it('backs off exponentially up to a day', () => {
    expect(backoff(15, 1)).toBe(30 * 60_000);
    expect(backoff(15, 3)).toBe(120 * 60_000);
    expect(backoff(600, 10)).toBe(24 * 60 * 60_000);
  });
});

describe('fetchText', () => {
  const allow = async () => true;

  it('follows redirects and checks every hop', async () => {
    const seen: string[] = [];
    const fetcher = async (url: string) => {
      seen.push(url);
      if (url === 'https://a.example/feed') {
        return new Response(null, { status: 301, headers: { location: '/moved' } });
      }
      return new Response('<rss/>', { status: 200, headers: { etag: '"v1"' } });
    };
    const checked: string[] = [];
    const result = await fetchText('https://a.example/feed', {}, fetcher, async (url) => {
      checked.push(url);
      return true;
    });
    expect(result).toMatchObject({ status: 'ok', body: '<rss/>', etag: '"v1"' });
    expect(checked).toEqual(['https://a.example/feed', 'https://a.example/moved']);
    expect(seen).toHaveLength(2);
  });

  it('blocks private targets', async () => {
    await expect(
      fetchText(
        'https://a.example/feed',
        {},
        async () => new Response(''),
        async () => false,
      ),
    ).rejects.toMatchObject({ code: 'blocked_url' });
  });

  it('reports unchanged feeds and sends validators', async () => {
    let headers: Headers | null = null;
    const fetcher = async (_url: string, init: RequestInit) => {
      headers = new Headers(init.headers);
      return new Response(null, { status: 304 });
    };
    const result = await fetchText('https://a.example/feed', { etag: '"v1"' }, fetcher, allow);
    expect(result.status).toBe('unchanged');
    expect((headers as Headers | null)?.get('if-none-match')).toBe('"v1"');
  });

  it('caps the body size', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024);
    await expect(
      fetchText('https://a.example/feed', {}, async () => new Response(big), allow),
    ).rejects.toBeInstanceOf(FeedError);
  });

  it('maps http errors to codes', async () => {
    await expect(
      fetchText('https://a.example/feed', {}, async () => new Response('', { status: 404 }), allow),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
