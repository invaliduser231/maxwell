import definition, { defaultEscalation, moderationConfig } from '@maxwell/core/modules/moderation';
import type { CaseRow } from '@maxwell/core/stores/moderation';
import { describe, expect, it } from 'vitest';
import { modRoleAllow } from '../../src/modules/moderation/access.js';
import { excerptOf, replyExcerpt } from '../../src/modules/moderation/commands/actions.js';
import { describeFilter, parseSlowmode } from '../../src/modules/moderation/commands/channels.js';
import { caseDuration, caseEmbed } from '../../src/modules/moderation/embeds.js';
import { escalationFor, sortedSteps } from '../../src/modules/moderation/escalation.js';
import { auditCase, timeoutTransition } from '../../src/modules/moderation/events.js';
import { AuditHolds, BoundedMap, ExpectedActions } from '../../src/modules/moderation/expected.js';
import { diffNames } from '../../src/modules/moderation/names.js';
import {
  isLocked,
  lockPlan,
  onlySend,
  revertSend,
  toState,
  unlockPlan,
} from '../../src/modules/moderation/overwrites.js';
import { matchesPurge, parsePurgeFilter } from '../../src/modules/moderation/purge-filter.js';
import { riskHints } from '../../src/modules/moderation/risk.js';
import { auditReason, humanDuration, renderTemplate } from '../../src/modules/moderation/text.js';
import {
  AuditAction,
  type IncomingMessage,
  type Overwrite,
  type Platform,
} from '../../src/platform/types.js';
import type { Services } from '../../src/services.js';
import { palette } from '../../src/ui/palette.js';

const DAY = 86_400_000;

describe('moderation config', () => {
  it('parses an empty config with defaults', () => {
    const config = moderationConfig.parse({});
    expect(config.logChannelId).toBeNull();
    expect(config.escalationSteps).toEqual(defaultEscalation);
    expect(config.warnExpiryDays).toBe(90);
    expect(config.dmActions).toEqual(['warn', 'timeout', 'kick', 'ban']);
  });

  it('keeps its migrations prefixed with the module key', () => {
    for (const migration of definition.migrations) {
      const tables = [...migration.up.matchAll(/create table (\w+)/g)].map((m) => m[1]);
      for (const table of tables) expect(table?.startsWith('moderation_')).toBe(true);
    }
  });
});

describe('text helpers', () => {
  it('writes durations out', () => {
    expect(humanDuration(10 * 60_000)).toBe('10 minutes');
    expect(humanDuration(3_600_000)).toBe('1 hour');
    expect(humanDuration(DAY + 3 * 3_600_000)).toBe('1 day 3 hours');
    expect(humanDuration(14 * DAY)).toBe('2 weeks');
    expect(humanDuration(500)).toBe('1 second');
  });

  it('fills known template variables only', () => {
    expect(
      renderTemplate('You were {action} in {server}. {unknown}', {
        action: 'warned',
        server: 'Lab',
      }),
    ).toBe('You were warned in Lab. {unknown}');
  });

  it('builds a bounded audit reason', () => {
    expect(auditReason('spam', 'lena')).toBe('spam (by lena)');
    expect(auditReason('x'.repeat(600), null)).toHaveLength(500);
  });
});

describe('escalation ladder', () => {
  const steps = defaultEscalation;

  it('fires on exact thresholds', () => {
    expect(escalationFor(steps, 1)).toBeNull();
    expect(escalationFor(steps, 3)?.durationMinutes).toBe(60);
    expect(escalationFor(steps, 4)).toBeNull();
    expect(escalationFor(steps, 5)?.durationMinutes).toBe(1_440);
  });

  it('repeats the top step past the end', () => {
    expect(escalationFor(steps, 7)?.review).toBe(true);
    expect(escalationFor(steps, 9)?.action).toBe('ban');
  });

  it('sorts and dedupes steps', () => {
    const messy = [
      { warns: 5, action: 'kick' as const, durationMinutes: null, review: false },
      { warns: 2, action: 'timeout' as const, durationMinutes: 5, review: false },
      { warns: 5, action: 'ban' as const, durationMinutes: null, review: false },
    ];
    expect(sortedSteps(messy).map((s) => [s.warns, s.action])).toEqual([
      [2, 'timeout'],
      [5, 'ban'],
    ]);
    expect(escalationFor([], 10)).toBeNull();
  });
});

function message(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: '1',
    channelId: '2',
    guildId: '3',
    content: 'hello there',
    author: {
      id: '400000000000000001',
      username: 'lena',
      displayName: 'Lena',
      bot: false,
      avatarUrl: '',
    },
    memberRoles: [],
    fromWebhook: false,
    attachments: [],
    embeds: [],
    mentionUsers: [],
    mentionRoles: [],
    mentionEveryone: false,
    replyTo: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('purge filters', () => {
  it('parses members, bots, links and contains', () => {
    const parsed = parsePurgeFilter('<@400000000000000001> bots links contains Free Nitro');
    expect(parsed).toEqual({
      ok: true,
      filter: {
        users: ['400000000000000001'],
        bots: true,
        links: true,
        contains: 'free nitro',
      },
    });
    expect(parsePurgeFilter('contains:"spam"')).toMatchObject({
      ok: true,
      filter: { contains: 'spam' },
    });
  });

  it('rejects unknown words', () => {
    expect(parsePurgeFilter('everything')).toEqual({ ok: false, token: 'everything' });
    expect(parsePurgeFilter('contains')).toEqual({ ok: false, token: 'contains' });
  });

  it('matches messages against all filters', () => {
    const lena = message();
    const link = message({ content: 'see https://example.com' });
    const bot = message({ author: { ...lena.author, id: '5', bot: true } });
    const filter = (text: string) => {
      const parsed = parsePurgeFilter(text);
      if (!parsed.ok) throw new Error(parsed.token);
      return parsed.filter;
    };
    expect(matchesPurge(lena, filter(''))).toBe(true);
    expect(matchesPurge(lena, filter('links'))).toBe(false);
    expect(matchesPurge(link, filter('links'))).toBe(true);
    expect(matchesPurge(bot, filter('bots'))).toBe(true);
    expect(matchesPurge(lena, filter('bots'))).toBe(false);
    expect(matchesPurge(lena, filter('400000000000000001 contains THERE'))).toBe(true);
    expect(matchesPurge(link, filter('400000000000000002'))).toBe(false);
    expect(describeFilter(filter('bots links'))).toBe('`bots` `links`');
  });

  it('parses slowmode delays', () => {
    expect(parseSlowmode('off')).toBe(0);
    expect(parseSlowmode('10s')).toBe(10);
    expect(parseSlowmode('2m')).toBe(120);
    expect(parseSlowmode('30')).toBe(30);
    expect(parseSlowmode('soon')).toBe('bad');
  });
});

describe('lock overwrites', () => {
  const guild = '900';
  const hidden: Overwrite = { id: guild, type: 'role', allow: [], deny: ['ViewChannel'] };

  it('keeps existing denies and adds send for keepers', () => {
    const plan = lockPlan([hidden], guild, [
      { id: 'mod', type: 'role' },
      { id: 'bot', type: 'member' },
    ]);
    if (plan === 'already') throw new Error('unexpected');
    expect(plan[0]?.after.deny).toEqual(['ViewChannel', 'SendMessages']);
    expect(plan[0]?.before?.deny).toEqual(['ViewChannel']);
    expect(plan.slice(1).map((change) => [change.id, change.after.allow])).toEqual([
      ['mod', ['SendMessages']],
      ['bot', ['SendMessages']],
    ]);
  });

  it('notices an existing lock', () => {
    const locked: Overwrite = { id: guild, type: 'role', allow: [], deny: ['SendMessages'] };
    expect(lockPlan([locked], guild, [])).toBe('already');
    expect(isLocked([locked], guild)).toBe(true);
    expect(isLocked([hidden], guild)).toBe(false);
  });

  it('reverts only the send permission', () => {
    const plan = lockPlan(
      [{ id: guild, type: 'role', allow: ['SendMessages'], deny: [] }],
      guild,
      [],
    );
    if (plan === 'already' || !plan[0]) throw new Error('unexpected');
    const now: Overwrite = {
      id: guild,
      type: 'role',
      allow: ['AddReactions'],
      deny: ['SendMessages', 'ViewChannel'],
    };
    expect(revertSend(now, plan[0])).toEqual({
      id: guild,
      type: 'role',
      allow: ['AddReactions', 'SendMessages'],
      deny: ['ViewChannel'],
    });
  });

  it('plans an unlock for channels locked by hand', () => {
    expect(unlockPlan([hidden], guild)).toBe('notLocked');
    const plan = unlockPlan(
      [{ id: guild, type: 'role', allow: [], deny: ['SendMessages', 'ViewChannel'] }],
      guild,
    );
    if (plan === 'notLocked') throw new Error('unexpected');
    expect(plan.after.deny).toEqual(['ViewChannel']);
  });
});

describe('risk hints', () => {
  const now = Date.UTC(2026, 9, 21);

  it('flags young accounts, fresh joins, renames, warns and bans', () => {
    const hints = riskHints({
      accountCreated: new Date(now - 2 * DAY),
      joinedAt: new Date(now - 3_600_000),
      nameChanges: 4,
      activeWarns: 2,
      bans: 1,
      now,
    });
    expect(hints).toEqual([
      'Account is 2 days old.',
      'Joined in the last 24 hours.',
      'Changed names 4 times.',
      '2 active warnings.',
      'Banned here before.',
    ]);
  });

  it('stays quiet for settled members', () => {
    expect(
      riskHints({
        accountCreated: new Date(now - 400 * DAY),
        joinedAt: new Date(now - 100 * DAY),
        nameChanges: 1,
        activeWarns: 0,
        bans: 0,
        now,
      }),
    ).toEqual([]);
  });
});

describe('name history', () => {
  const user = { id: '1', username: 'lena', displayName: 'Lena', bot: false, avatarUrl: '' };

  it('records a baseline first', () => {
    expect(diffNames(null, user).every((change) => change.baseline)).toBe(true);
  });

  it('records changed usernames and display names', () => {
    const changes = diffNames(
      { username: 'lena', display: 'Lena' },
      { ...user, username: 'lena2', displayName: 'L' },
    );
    expect(changes).toEqual([
      { kind: 'username', value: 'lena2', previous: 'lena', baseline: false },
      { kind: 'display', value: 'L', previous: 'Lena', baseline: false },
    ]);
    expect(diffNames({ username: 'lena', display: 'Lena' }, user)).toEqual([]);
  });
});

describe('timeout transitions', () => {
  const now = Date.now();
  const later = new Date(now + 60_000);

  it('detects new and lifted timeouts', () => {
    expect(
      timeoutTransition(
        { timeoutUntil: later, before: { nick: null, roles: [], timeoutUntil: null } },
        now,
      ),
    ).toBe('set');
    expect(
      timeoutTransition(
        { timeoutUntil: null, before: { nick: null, roles: [], timeoutUntil: later } },
        now,
      ),
    ).toBe('cleared');
    expect(
      timeoutTransition(
        { timeoutUntil: later, before: { nick: null, roles: [], timeoutUntil: later } },
        now,
      ),
    ).toBeNull();
    expect(timeoutTransition({ timeoutUntil: later, before: null }, now)).toBeNull();
  });
});

describe('bounded state', () => {
  it('forgets expected actions after use or expiry', () => {
    const expected = new ExpectedActions(1_000, 2);
    expected.expect('g', 'u', 'ban', 0);
    expect(expected.take('g', 'u', 'ban', 10)).toBe(true);
    expect(expected.take('g', 'u', 'ban', 10)).toBe(false);
    expected.expect('g', 'u', 'ban', 0);
    expect(expected.take('g', 'u', 'ban', 5_000)).toBe(false);
    for (const user of ['a', 'b', 'c']) expected.expect('g', user, 'ban', 0);
    expect(expected.size).toBe(2);
  });

  it('evicts the least recently used entry', () => {
    const map = new BoundedMap<string, number>(2);
    map.set('a', 1);
    map.set('b', 2);
    map.get('a');
    map.set('c', 3);
    expect(map.get('b')).toBeUndefined();
    expect(map.get('a')).toBe(1);
  });
});

describe('case embed', () => {
  const row: CaseRow = {
    guildId: '1',
    number: 42,
    action: 'ban',
    userId: '400000000000000001',
    moderatorId: null,
    reason: null,
    durationSeconds: null,
    expiresAt: null,
    endedAt: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    evidence: [],
    excerpt: null,
    meta: { external: true },
    logChannelId: null,
    logMessageId: null,
    editedBy: null,
    editedAt: null,
    createdAt: new Date(),
  };

  it('follows the case layout', () => {
    const embed = caseEmbed(row, null, '!');
    expect(embed.title).toBe('Case 42: Ban');
    expect(embed.color).toBe(palette.danger);
    expect(embed.fields?.map((field) => field.name)).toEqual([
      'Member',
      'Moderator',
      'Duration',
      'Reason',
    ]);
    expect(embed.fields?.[1]?.value).toBe('Unknown');
    expect(embed.fields?.[3]?.value).toContain('!reason 42 <text>');
    expect(embed.footer).toBe('User 400000000000000001 / Case 42');
  });

  it('greys out void cases', () => {
    const embed = caseEmbed(
      { ...row, voidedAt: new Date(), voidedBy: '5', voidReason: 'mistake' },
      null,
      '!',
    );
    expect(embed.color).toBe(palette.muted);
    expect(embed.title).toBe('Case 42: Ban (void)');
    expect(caseDuration({ action: 'timeout', durationSeconds: 600 })).toBe('10 minutes');
    expect(caseDuration({ action: 'warn', durationSeconds: null })).toBeNull();
  });
});

describe('audit log entries', () => {
  const now = Date.UTC(2026, 9, 21, 12);

  it('maps kicks, bans and timeouts to case actions', () => {
    expect(auditCase({ action: AuditAction.MemberKick, changes: [] }, now)).toBe('kick');
    expect(auditCase({ action: AuditAction.MemberBanAdd, changes: [] }, now)).toBe('ban');
    expect(auditCase({ action: AuditAction.MemberBanRemove, changes: [] }, now)).toBe('unban');
    const timeout = (after: unknown) => ({
      action: AuditAction.MemberUpdate,
      changes: [{ key: 'communication_disabled_until', before: null, after }],
    });
    expect(auditCase(timeout(new Date(now + 60_000).toISOString()), now)).toBe('timeout');
    expect(auditCase(timeout(null), now)).toBe('untimeout');
    expect(auditCase({ action: AuditAction.MemberUpdate, changes: [] }, now)).toBeNull();
    expect(auditCase({ action: AuditAction.RoleDelete, changes: [] }, now)).toBeNull();
  });

  it('holds attributions briefly and hands each out once', () => {
    const holds = new AuditHolds(1_000);
    holds.hold('g', 'u', 'ban', { actorId: 'm', reason: 'raid' }, 0);
    expect(holds.take('g', 'u', 'timeout', 10)).toBeNull();
    expect(holds.take('g', 'u', 'ban', 10)).toEqual({ actorId: 'm', reason: 'raid' });
    expect(holds.take('g', 'u', 'ban', 10)).toBeNull();
    holds.hold('g', 'u', 'ban', { actorId: 'm', reason: null }, 0);
    expect(holds.take('g', 'u', 'ban', 5_000)).toBeNull();
  });
});

describe('raw channel overwrites', () => {
  const send = String(1n << 11n);
  const view = String(1n << 10n);
  const unknown = String(1n << 50n);

  it('converts raw bits to named overwrites', () => {
    const state = toState({
      id: '5',
      guildId: '900',
      name: 'general',
      type: 0,
      parentId: null,
      position: 0,
      topic: null,
      nsfw: false,
      userLimit: null,
      rateLimitPerUser: 30,
      overwrites: [
        { id: '900', type: 'role', allow: '0', deny: String((1n << 11n) | (1n << 10n)) },
      ],
    });
    expect(state.overwrites).toEqual([
      { id: '900', type: 'role', allow: [], deny: ['ViewChannel', 'SendMessages'] },
    ]);
    expect(state.rateLimitPerUser).toBe(30);
    expect(isLocked(state.overwrites, '900')).toBe(true);
  });

  it('only drops overwrites that hold nothing but send', () => {
    expect(onlySend(null)).toBe(true);
    expect(onlySend({ id: '1', type: 'role', allow: send, deny: '0' })).toBe(true);
    expect(onlySend({ id: '1', type: 'role', allow: send, deny: view })).toBe(false);
    expect(onlySend({ id: '1', type: 'member', allow: '0', deny: unknown })).toBe(false);
  });
});

describe('reply excerpts', () => {
  const lena = message().author;

  it('joins text and attachment links', () => {
    expect(excerptOf(message({ content: '  spam  ' }))).toBe('spam');
    expect(
      excerptOf(
        message({
          content: '',
          attachments: [
            { url: 'https://cdn.example/a.png', filename: 'a.png', contentType: null, size: 1 },
          ],
        }),
      ),
    ).toBe('https://cdn.example/a.png');
    expect(excerptOf(message({ content: ' ' }))).toBeNull();
  });

  it('uses the replied-to message only when the target wrote it', async () => {
    const replied = message({ id: '77', content: 'buy followers' });
    const platform = {
      message: async (_channel: string, id: string) => (id === '77' ? replied : null),
    } as unknown as Platform;
    const command = message({ id: '78', replyTo: '77', author: { ...lena, id: '9' } });
    expect(await replyExcerpt(platform, command, lena.id)).toBe('buy followers');
    expect(await replyExcerpt(platform, command, '400000000000000002')).toBeNull();
    expect(await replyExcerpt(platform, message({ replyTo: null }), lena.id)).toBeNull();
  });
});

describe('mod role access', () => {
  const services = (modRoleIds: string[]) =>
    ({
      settings: { config: async () => moderationConfig.parse({ modRoleIds }) },
    }) as unknown as Services;

  it('lets members with a mod role through', async () => {
    expect(await modRoleAllow(message({ memberRoles: ['mods'] }), services(['mods']))).toBe(true);
    expect(await modRoleAllow(message({ memberRoles: ['fans'] }), services(['mods']))).toBe(false);
    expect(
      await modRoleAllow(message({ guildId: null, memberRoles: ['mods'] }), services(['mods'])),
    ).toBe(false);
  });
});
