import { automodConfig } from '@maxwell/core/modules/automod';
import type { StoredMessage } from '@maxwell/core/stores/automod';
import { describe, expect, it } from 'vitest';
import { DryRunner, parseRule } from '../../src/modules/automod/dryrun.js';
import { decide, quote } from '../../src/modules/automod/enforce.js';
import { modRoleSet } from '../../src/modules/automod/lookup.js';
import {
  type Candidate,
  capsPercent,
  compileWords,
  countEmojis,
  domainMatches,
  findInvites,
  findLinks,
  inviteCode,
  matchWords,
  RuleEngine,
} from '../../src/modules/automod/rules.js';
import { JoinWindow } from '../../src/modules/automod/shield.js';

const FLUXER_EPOCH = 1_420_070_400_000n;
const OLD_USER = '100000000000000001';
const GUILD = '900000000000000001';

function idAt(date: Date): string {
  return String((BigInt(date.getTime()) - FLUXER_EPOCH) << 22n);
}

function config(rules: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return automodConfig.parse({ ...extra, rules });
}

let seq = 0;
function msg(content: string, extra: Partial<Candidate> = {}): Candidate {
  seq++;
  return {
    guildId: GUILD,
    id: String(500000000000000000n + BigInt(seq)),
    channelId: '700000000000000001',
    parentId: null,
    authorId: OLD_USER,
    bot: false,
    roles: [],
    content,
    mentionUsers: 0,
    mentionRoles: 0,
    createdAt: new Date('2026-10-21T12:00:00Z'),
    ...extra,
  };
}

describe('detectors', () => {
  it('finds invite codes on Fluxer and Discord hosts', () => {
    expect(findInvites('join fluxer.gg/AbC123 now')).toEqual([
      { host: 'fluxer.gg', code: 'AbC123' },
    ]);
    expect(findInvites('https://discord.com/invite/xyz-9')).toEqual([
      { host: 'discord.com/invite', code: 'xyz-9' },
    ]);
    expect(findInvites('https://web.fluxer.app/invite/qq11')[0]?.code).toBe('qq11');
    expect(findInvites('no links here')).toEqual([]);
  });

  it('reads invite codes from allow list entries', () => {
    expect(inviteCode('https://fluxer.gg/WaO6qGdU')).toBe('WaO6qGdU');
    expect(inviteCode('WaO6qGdU')).toBe('WaO6qGdU');
  });

  it('finds link hosts with and without a scheme', () => {
    expect(findLinks('see https://Sub.Example.com/path?x=1 and http://user@evil.io:8080/')).toEqual(
      ['sub.example.com', 'evil.io'],
    );
    expect(findLinks('grab it at bit.ly/abc')).toEqual(['bit.ly']);
    expect(findLinks('visit scam.xyz today')).toEqual(['scam.xyz']);
  });

  it('ignores things that only look like domains', () => {
    expect(findLinks('I love node.js and file.txt')).toEqual([]);
    expect(findLinks('mail me at lena@example.com')).toEqual([]);
    expect(findLinks('e.g. this, i.e. that')).toEqual([]);
  });

  it('matches domains with subdomains and loose list entries', () => {
    expect(domainMatches('cdn.example.com', ['example.com'])).toBe(true);
    expect(domainMatches('www.example.com', ['https://example.com/'])).toBe(true);
    expect(domainMatches('a.b.example.com', ['*.example.com'])).toBe(true);
    expect(domainMatches('notexample.com', ['example.com'])).toBe(false);
  });

  it('measures capitals over letters only', () => {
    expect(capsPercent('HELLO THERE <@123456789012345678>')).toEqual({ letters: 10, percent: 100 });
    expect(capsPercent('Hello there').percent).toBe(10);
    expect(capsPercent('1234 !!').letters).toBe(0);
  });

  it('counts unicode, flag, joined and custom emojis', () => {
    expect(countEmojis('hi \u{1F600}\u{1F600}')).toBe(2);
    expect(countEmojis('\u{1F468}‍\u{1F469}‍\u{1F467}')).toBe(1);
    expect(countEmojis('\u{1F1E9}\u{1F1EA}')).toBe(1);
    expect(countEmojis('<:mx_ok:123456789> <a:spin:987654321>')).toBe(2);
    expect(countEmojis('plain text')).toBe(0);
  });

  it('matches word patterns with wildcards and word boundaries', () => {
    expect(matchWords('that is badword', ['bad*'])).toBe('bad*');
    expect(matchWords('superbad move', ['*bad'])).toBe('*bad');
    expect(matchWords('a badge', ['bad'])).toBeNull();
    expect(matchWords('FREE   nitro here', ['free nitro'])).toBe('free nitro');
    expect(matchWords('bád', ['bad'])).toBe('bad');
    expect(matchWords('zero​width', ['zerowidth'])).toBe('zerowidth');
    expect(matchWords('second hit', ['first', 'second'])).toBe('second');
  });

  it('treats regex characters in patterns as text', () => {
    expect(matchWords('price is $5 (cheap)', ['$5 (cheap)'])).toBe('$5 (cheap)');
    expect(compileWords(['*', '  '])).toBeNull();
  });
});

describe('RuleEngine', () => {
  it('flags spam once the rate is exceeded', () => {
    const engine = new RuleEngine();
    const cfg = config({ spam: { mode: 'enforce', maxMessages: 3, perSeconds: 5 } });
    const base = Date.parse('2026-10-21T12:00:00Z');
    const results = [0, 1000, 2000, 3000].map(
      (offset) =>
        engine.evaluate(cfg, msg('hi', { createdAt: new Date(base + offset) }), false).length,
    );
    expect(results).toEqual([0, 0, 0, 1]);
    const later = engine.evaluate(cfg, msg('hi', { createdAt: new Date(base + 60_000) }), false);
    expect(later).toEqual([]);
  });

  it('flags repeated messages', () => {
    const engine = new RuleEngine();
    const cfg = config({ repeats: { mode: 'log', maxRepeats: 2, perSeconds: 60 } });
    const at = (s: number) => new Date(Date.parse('2026-10-21T12:00:00Z') + s * 1000);
    expect(engine.evaluate(cfg, msg('buy my stuff', { createdAt: at(0) }), false)).toEqual([]);
    expect(engine.evaluate(cfg, msg('Buy my  stuff', { createdAt: at(5) }), false)).toEqual([]);
    expect(engine.evaluate(cfg, msg('buy my stuff', { createdAt: at(10) }), false)).toEqual([
      { rule: 'repeats', detail: 'same message 3 times' },
    ]);
    expect(engine.evaluate(cfg, msg('ok', { createdAt: at(11) }), false)).toEqual([]);
  });

  it('skips stateful rules for edits', () => {
    const engine = new RuleEngine();
    const cfg = config({ spam: { mode: 'enforce', maxMessages: 1 }, caps: { mode: 'enforce' } });
    engine.evaluate(cfg, msg('a'), false);
    const hits = engine.evaluate(cfg, msg('THIS IS VERY LOUD TEXT'), false, { stateless: true });
    expect(hits.map((hit) => hit.rule)).toEqual(['caps']);
  });

  it('applies global and rule exemptions', () => {
    const engine = new RuleEngine();
    const cfg = config(
      {
        invites: {
          mode: 'enforce',
          exemptChannelIds: ['700000000000000009'],
          exemptRoleIds: ['r1'],
        },
      },
      { exemptChannelIds: ['700000000000000002'] },
    );
    const text = 'fluxer.gg/abc';
    expect(engine.evaluate(cfg, msg(text), false)).toHaveLength(1);
    expect(engine.evaluate(cfg, msg(text, { channelId: '700000000000000002' }), false)).toEqual([]);
    expect(engine.evaluate(cfg, msg(text, { parentId: '700000000000000009' }), false)).toEqual([]);
    expect(engine.evaluate(cfg, msg(text, { roles: ['r1'] }), false)).toEqual([]);
    expect(engine.evaluate(cfg, msg(text), true)).toEqual([]);
    expect(engine.evaluate(cfg, msg(text, { bot: true }), false)).toEqual([]);
  });

  it('honours allowed invite codes', () => {
    const engine = new RuleEngine();
    const cfg = config({ invites: { mode: 'log', allowedCodes: ['https://fluxer.gg/home'] } });
    expect(engine.evaluate(cfg, msg('fluxer.gg/home'), false)).toEqual([]);
    expect(engine.evaluate(cfg, msg('fluxer.gg/other'), false)[0]?.detail).toBe(
      'invite fluxer.gg/other',
    );
  });

  it('checks links against deny and allow lists', () => {
    const engine = new RuleEngine();
    const deny = config({ links: { mode: 'enforce', domains: ['evil.io'] } });
    expect(engine.evaluate(deny, msg('https://evil.io/x'), false)).toHaveLength(1);
    expect(engine.evaluate(deny, msg('https://good.io/x'), false)).toEqual([]);
    const allow = config({ links: { mode: 'enforce', listMode: 'allow', domains: ['good.io'] } });
    expect(engine.evaluate(allow, msg('https://www.good.io/x'), false)).toEqual([]);
    expect(engine.evaluate(allow, msg('https://other.io/x'), false)[0]?.detail).toBe(
      'link to other.io',
    );
  });

  it('counts mentions with or without roles', () => {
    const engine = new RuleEngine();
    const withRoles = config({ mentions: { mode: 'enforce', maxMentions: 3 } });
    const noRoles = config({ mentions: { mode: 'enforce', maxMentions: 3, countRoles: false } });
    const loud = msg('hey', { mentionUsers: 2, mentionRoles: 2 });
    expect(engine.evaluate(withRoles, loud, false)[0]?.detail).toBe('4 mentions');
    expect(engine.evaluate(noRoles, loud, false)).toEqual([]);
  });

  it('respects the caps minimum length and emoji limit', () => {
    const engine = new RuleEngine();
    const cfg = config({
      caps: { mode: 'enforce', minLength: 10, maxPercent: 70 },
      emoji: { mode: 'enforce', maxEmojis: 2 },
    });
    expect(engine.evaluate(cfg, msg('OK FINE'), false)).toEqual([]);
    expect(engine.evaluate(cfg, msg('WHY IS EVERYONE SO QUIET'), false)[0]?.rule).toBe('caps');
    expect(engine.evaluate(cfg, msg('\u{1F600}\u{1F600}\u{1F600}'), false)[0]?.rule).toBe('emoji');
  });

  it('flags links from new accounts only', () => {
    const engine = new RuleEngine();
    const cfg = config({ newAccountLinks: { mode: 'enforce', minAccountAgeHours: 24 } });
    const now = new Date('2026-10-21T12:00:00Z');
    const fresh = idAt(new Date(now.getTime() - 2 * 3_600_000));
    expect(
      engine.evaluate(cfg, msg('https://x.io', { authorId: fresh, createdAt: now }), false)[0]
        ?.detail,
    ).toBe('link from an account 2h old');
    expect(engine.evaluate(cfg, msg('hello', { authorId: fresh, createdAt: now }), false)).toEqual(
      [],
    );
    expect(engine.evaluate(cfg, msg('https://x.io', { createdAt: now }), false)).toEqual([]);
  });

  it('ignores rules that are off', () => {
    const engine = new RuleEngine();
    const cfg = config({ caps: { mode: 'off' } });
    expect(engine.evaluate(cfg, msg('THIS IS VERY LOUD TEXT'), false)).toEqual([]);
  });

  it('keeps the tracked authors bounded', () => {
    const engine = new RuleEngine(10);
    const cfg = config({ spam: { mode: 'enforce' } });
    for (let i = 0; i < 50; i++)
      engine.evaluate(cfg, msg('x', { authorId: String(1000 + i) }), false);
    expect(engine.tracked).toBe(10);
  });
});

describe('decide', () => {
  it('picks the strongest enforced action and longest timeout', () => {
    const cfg = config({
      caps: { mode: 'enforce', action: 'timeout', timeoutMinutes: 5, deleteMessage: false },
      spam: { mode: 'enforce', action: 'timeout', timeoutMinutes: 30, deleteMessage: false },
      invites: { mode: 'log', action: 'ban' },
    });
    const verdict = decide(cfg, [
      { rule: 'caps', detail: '' },
      { rule: 'spam', detail: '' },
      { rule: 'invites', detail: '' },
    ]);
    expect(verdict.action).toBe('timeout');
    expect(verdict.timeoutMinutes).toBe(30);
    expect(verdict.deleteMessage).toBe(false);
  });

  it('reports log only hits without an action', () => {
    const cfg = config({ caps: { mode: 'log' } });
    const verdict = decide(cfg, [{ rule: 'caps', detail: '' }]);
    expect(verdict.action).toBeNull();
    expect(verdict.primary?.rule).toBe('caps');
    expect(verdict.deleteMessage).toBe(false);
  });

  it('quotes every line', () => {
    expect(quote('a\nb')).toBe('> a\n> b');
  });
});

describe('mods and joins', () => {
  it('treats roles with moderation permissions as mod roles', () => {
    const roles = [
      {
        id: GUILD,
        name: '@everyone',
        color: 0,
        position: 0,
        permissions: String(1n << 13n),
        managed: false,
        hoist: false,
        mentionable: false,
      },
      {
        id: 'helper',
        name: 'Helper',
        color: 0,
        position: 1,
        permissions: String(1n << 40n),
        managed: false,
        hoist: false,
        mentionable: false,
      },
      {
        id: 'member',
        name: 'Member',
        color: 0,
        position: 2,
        permissions: String(1n << 11n),
        managed: false,
        hoist: false,
        mentionable: false,
      },
    ];
    const set = modRoleSet(GUILD, ['custom'], roles);
    expect([...set].sort()).toEqual(['custom', 'helper']);
  });

  it('keeps a sliding join window per guild', () => {
    const window = new JoinWindow();
    window.push('g', { at: 0, userId: 'a' }, 10);
    window.push('g', { at: 5_000, userId: 'b' }, 10);
    expect(window.push('g', { at: 12_000, userId: 'c' }, 10).map((e) => e.userId)).toEqual([
      'b',
      'c',
    ]);
    expect(window.push('g', { at: 13_000, userId: 'c' }, 10)).toHaveLength(2);
  });
});

describe('dry run', () => {
  function stored(content: string, authorRoles: string[] = [], minute = 0): StoredMessage {
    seq++;
    return {
      guildId: GUILD,
      messageId: String(600000000000000000n + BigInt(seq)),
      channelId: '700000000000000001',
      authorId: OLD_USER,
      authorRoles,
      authorBot: false,
      content,
      mentionUsers: 0,
      mentionRoles: 0,
      createdAt: new Date(Date.parse('2026-10-20T12:00:00Z') + minute * 60_000),
    };
  }

  it('counts catches and catches by moderators', () => {
    const parsed = parseRule('words', { patterns: ['scam*'], exemptMods: true });
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const base = automodConfig.parse({});
    const runner = new DryRunner(parsed.key, parsed.rule, base, new Set(['mod']), new Map());
    runner.feed([
      stored('this is a scam'),
      stored('scammer alert', ['mod']),
      stored('all fine'),
      stored('SCAMS everywhere', [], 1),
    ]);
    const result = runner.result();
    expect(result).toMatchObject({ scanned: 4, caught: 3, byMods: 1 });
    expect(result.samples.map((sample) => sample.byMod)).toEqual([false, true, false]);
    expect(result.samples[0]?.detail).toBe('matched scam*');
  });

  it('rejects unknown rules and bad input', () => {
    expect(parseRule('nope', {})).toBeNull();
    expect(parseRule('spam', { maxMessages: 'lots' })).toBeNull();
    expect(parseRule('spam', undefined)?.rule).toMatchObject({ maxMessages: 5 });
  });
});
