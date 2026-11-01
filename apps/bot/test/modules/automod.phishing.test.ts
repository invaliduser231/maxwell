import { automodConfig } from '@maxwell/core/modules/automod';
import type { PhishingStore, PhishingSync } from '@maxwell/core/stores/phishing';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';
import {
  acceptList,
  cleanDomain,
  downloadList,
  editDistance,
  lookalike,
  MIN_LIST_SIZE,
  PHISHING_EVERY,
  PhishingIndex,
  parseDomainList,
  skeleton,
} from '../../src/modules/automod/phishing.js';
import { PhishingFeed, syncAt } from '../../src/modules/automod/phishing-feed.js';
import { type Candidate, RuleEngine } from '../../src/modules/automod/rules.js';

const silent = createLogger('silent', false);

function msg(content: string): Candidate {
  return {
    guildId: '900000000000000001',
    id: '500000000000000001',
    channelId: '700000000000000001',
    parentId: null,
    authorId: '100000000000000001',
    bot: false,
    roles: [],
    content,
    mentionUsers: 0,
    mentionRoles: 0,
    createdAt: new Date('2026-10-21T12:00:00Z'),
  };
}

function many(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `scam${i}.example`);
}

describe('phishing list parsing', () => {
  it('reads a JSON array', () => {
    expect(parseDomainList('["Dlscord.net", "steamcomunnilty.com", 5, "not a domain"]')).toEqual([
      'dlscord.net',
      'steamcomunnilty.com',
    ]);
  });

  it('reads an object with a domains array', () => {
    expect(parseDomainList('{"domains":["a-scam.ru","b-scam.xyz"]}')).toEqual([
      'a-scam.ru',
      'b-scam.xyz',
    ]);
  });

  it('reads plain text and hosts files', () => {
    const body = [
      '# comment',
      '! adblock comment',
      'free-nitro.gift',
      '0.0.0.0 steam-trade.ru',
      'https://www.discord-airdrop.com/claim?x=1',
      '*.bad-host.xyz',
      'trailing.example.com. # note',
      '',
      '127.0.0.1',
    ].join('\n');
    expect(parseDomainList(body)).toEqual([
      'free-nitro.gift',
      'steam-trade.ru',
      'discord-airdrop.com',
      'bad-host.xyz',
      'trailing.example.com',
    ]);
  });

  it('drops official and shared hosting domains and duplicates', () => {
    expect(
      parseDomainList(
        '["discord.com","cdn.discordapp.com","vercel.app","github.io","x.vercel.app","x.vercel.app"]',
      ),
    ).toEqual(['x.vercel.app']);
  });

  it('ignores broken JSON', () => {
    expect(parseDomainList('[“oops”')).toEqual([]);
  });

  it('cleans single entries', () => {
    expect(cleanDomain('HTTPS://User@WWW.Scam.Example:443/path')).toBe('scam.example');
    expect(cleanDomain('dіscord.com')).toBe('xn--dscord-pvf.com');
    expect(cleanDomain('localhost')).toBeNull();
    expect(cleanDomain('10.0.0.1')).toBeNull();
    expect(cleanDomain('http://84.200.91.87/login')).toBe('84.200.91.87');
  });

  it('rejects lists that are too small or shrink by half', () => {
    expect(acceptList(MIN_LIST_SIZE - 1, null)).toBe(false);
    expect(acceptList(MIN_LIST_SIZE, null)).toBe(true);
    expect(acceptList(4_000, 10_000)).toBe(false);
    expect(acceptList(9_000, 10_000)).toBe(true);
  });
});

describe('phishing domain matching', () => {
  const index = new PhishingIndex(['dlscord.net', 'scam.example', 'xn--dscord-pvf.com']);

  it('matches the domain and its subdomains', () => {
    expect(index.listed('dlscord.net')).toBe('dlscord.net');
    expect(index.listed('www.dlscord.net')).toBe('dlscord.net');
    expect(index.listed('gift.login.dlscord.net')).toBe('dlscord.net');
    expect(index.listed('notdlscord.net')).toBeNull();
    expect(index.listed('dlscord.net.example')).toBeNull();
    expect(index.listed('net')).toBeNull();
  });

  it('matches unicode hosts against punycode entries', () => {
    expect(index.listed('dіscord.com')).toBe('xn--dscord-pvf.com');
  });

  it('skips allowed domains', () => {
    const options = { lookalikes: true, allowed: ['scam.example'] };
    expect(index.check(['a.scam.example'], options)).toBeNull();
    expect(index.check(['dlscord.net'], options)).toEqual({ host: 'dlscord.net', brand: null });
  });

  it('can be replaced in place', () => {
    const live = new PhishingIndex();
    expect(live.size).toBe(0);
    live.replace(['scam.example']);
    expect(live.size).toBe(1);
    expect(live.listed('x.scam.example')).toBe('scam.example');
  });
});

describe('lookalike rules', () => {
  it('builds skeletons from confusable characters', () => {
    expect(skeleton('d1sc0rd')).toBe(skeleton('discord'));
    expect(skeleton('dіscord')).toBe(skeleton('discord'));
    expect(skeleton('steamcommmuunity')).toBe(skeleton('steamcommunity'));
    expect(skeleton('rnodern')).toBe('modem');
  });

  it('measures edit distance with transpositions', () => {
    expect(editDistance('discord', 'discord')).toBe(0);
    expect(editDistance('dicsord', 'discord')).toBe(1);
    expect(editDistance('discrd', 'discord')).toBe(1);
    expect(editDistance('a', 'abcdef', 2)).toBe(3);
  });

  it.each([
    ['dlscord.com', 'discord'],
    ['disc0rd.gg', 'discord'],
    ['dicsord.com', 'discord'],
    ['discorrd.app', 'discord'],
    ['xn--dscord-pvf.com', 'discord'],
    ['discord-nitro.ru', 'discord'],
    ['discord.gifts', 'discord'],
    ['discord.com.ru', 'discord'],
    ['fiuxer.app', 'fluxer'],
    ['f1uxer.gg', 'fluxer'],
    ['fluxer-gift.com', 'fluxer'],
    ['steamcommunlty.com', 'steam'],
    ['steamcomunnilty.com', 'steam'],
    ['steam-community.ru', 'steam'],
    ['stearncommunity.com', 'steam'],
    ['steampowerred.net', 'steam'],
    ['steamcommunity.com.trade-offer.ru', 'steam'],
    ['free-nitro.xyz', 'nitro'],
    ['nitro-gift.site', 'nitro'],
  ])('flags %s as %s', (host, brand) => {
    expect(lookalike(host)).toBe(brand);
  });

  it.each([
    'discord.com',
    'ptb.discord.com',
    'cdn.discordapp.com',
    'discord.gift',
    'fluxer.app',
    'web.fluxer.app',
    'fluxer.gg',
    'fluxerusercontent.com',
    'steamcommunity.com',
    'store.steampowered.com',
    'steamgifts.com',
    'fluxerlist.com',
    'fluxer.name',
    'discord.js.org',
    'discordjs.guide',
    'discordbotlist.com',
    'discords.com',
    'top.gg',
    'nitrotype.com',
    'steamdb.info',
    'github.com',
    'example.com',
  ])('leaves %s alone', (host) => {
    expect(lookalike(host)).toBeNull();
  });
});

describe('phishing rule', () => {
  const index = new PhishingIndex(['scam.example']);
  const engine = new RuleEngine(100, index);

  function config(rule: Record<string, unknown>) {
    return automodConfig.parse({ rules: { phishing: { mode: 'enforce', ...rule } } });
  }

  it('is off with delete as the action by default', () => {
    const rule = automodConfig.parse({}).rules.phishing;
    expect(rule.mode).toBe('off');
    expect(rule.action).toBe('delete');
    expect(rule.lookalikes).toBe(true);
  });

  it('catches listed domains and lookalikes', () => {
    const hits = engine.evaluate(config({}), msg('claim at https://login.scam.example/x'), false);
    expect(hits).toEqual([
      { rule: 'phishing', detail: 'known phishing domain login.scam.example' },
    ]);
    const look = engine.evaluate(config({}), msg('free stuff dlscord.com/gift'), false);
    expect(look[0]?.detail).toBe('dlscord.com imitates Discord');
  });

  it('respects the lookalike switch and allowed domains', () => {
    expect(engine.evaluate(config({ lookalikes: false }), msg('dlscord.com/gift'), false)).toEqual(
      [],
    );
    expect(
      engine.evaluate(config({ allowedDomains: ['scam.example'] }), msg('scam.example/x'), false),
    ).toEqual([]);
  });

  it('ignores normal links', () => {
    expect(
      engine.evaluate(config({}), msg('see https://fluxer.app and https://example.com'), false),
    ).toEqual([]);
  });
});

describe('phishing list download', () => {
  const ok = async () => true;

  it('parses the response body', async () => {
    const fetcher = async () => new Response('["scam.example","other.example"]');
    expect(await downloadList('https://list.example/domains', fetcher, ok)).toEqual([
      'scam.example',
      'other.example',
    ]);
  });

  it('refuses blocked addresses and bad responses', async () => {
    const fetcher = async () => new Response('[]');
    await expect(
      downloadList('https://list.example', fetcher, async () => false),
    ).rejects.toThrow();
    const failing = async () => new Response('nope', { status: 503 });
    await expect(downloadList('https://list.example', failing, ok)).rejects.toThrow();
  });
});

describe('phishing feed', () => {
  function memoryStore(initial: string[] = [], last: PhishingSync | null = null) {
    const state = { domains: initial, last };
    const store = {
      domains: async () => state.domains,
      lastSync: async () => state.last,
      latest: async () => state.last,
      replace: async (source: string, domains: readonly string[]) => {
        state.domains = [...domains];
        state.last = { source, fetchedAt: new Date(), domains: domains.length };
      },
    } as unknown as PhishingStore;
    return { store, state };
  }

  it('loads the stored list and plans the next sync', async () => {
    const fetchedAt = new Date('2026-10-01T00:00:00Z');
    const { store } = memoryStore(['scam.example'], {
      source: 's',
      fetchedAt,
      domains: 1,
    });
    const index = new PhishingIndex();
    const feed = new PhishingFeed(store, index, silent, async () => []);
    const now = fetchedAt.getTime() + 60_000;
    expect(await feed.load(now)).toBe(fetchedAt.getTime() + PHISHING_EVERY);
    expect(index.listed('scam.example')).toBe('scam.example');
    expect(await feed.load(fetchedAt.getTime() + PHISHING_EVERY * 2)).toBe(
      fetchedAt.getTime() + PHISHING_EVERY * 2,
    );
  });

  it('stores a good list and keeps the old one when the new one looks broken', async () => {
    const { store, state } = memoryStore();
    const index = new PhishingIndex();
    let next = many(MIN_LIST_SIZE * 2);
    const feed = new PhishingFeed(store, index, silent, async () => next);
    const now = 1_000_000;
    expect(await feed.sync(now)).toBe(now + PHISHING_EVERY);
    expect(index.size).toBe(MIN_LIST_SIZE * 2);
    next = many(10);
    expect(await feed.sync(now)).toBeLessThan(now + PHISHING_EVERY);
    expect(state.domains).toHaveLength(MIN_LIST_SIZE * 2);
    expect(index.size).toBe(MIN_LIST_SIZE * 2);
  });

  it('survives a failed download', async () => {
    const { store } = memoryStore();
    const feed = new PhishingFeed(store, new PhishingIndex(), silent, async () => {
      throw new Error('down');
    });
    expect(await feed.sync(0)).toBeGreaterThan(0);
  });

  it('uses one dedupe key per sync window', () => {
    expect(syncAt(PHISHING_EVERY + 1).dedupeKey).toBe(syncAt(PHISHING_EVERY * 2 - 1).dedupeKey);
    expect(syncAt(PHISHING_EVERY).dedupeKey).not.toBe(syncAt(PHISHING_EVERY * 2).dedupeKey);
  });
});
