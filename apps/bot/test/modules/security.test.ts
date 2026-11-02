import type { Sql } from '@maxwell/core';
import { automodConfig } from '@maxwell/core/modules/automod';
import definition, { securityConfig } from '@maxwell/core/modules/security';
import type { AutomodStore } from '@maxwell/core/stores/automod';
import type { BackupStore } from '@maxwell/core/stores/backups';
import type {
  CheckInput,
  SecurityCheck,
  SecurityEvent,
  SecurityRaid,
  SecurityStore,
} from '@maxwell/core/stores/security';
import { describe, expect, it, vi } from 'vitest';
import { withLanguage } from '../../src/i18n/language.js';
import {
  decoysFor,
  layout,
  looksLikeAnswer,
  matches,
  readTargets,
  renderCaptcha,
  targetColors,
} from '../../src/modules/security/captcha.js';
import { copy } from '../../src/modules/security/copy.js';
import { Guard } from '../../src/modules/security/guard.js';
import { Honeypot } from '../../src/modules/security/honeypot.js';
import { ActionCounter, grantsDanger, NukeWatch } from '../../src/modules/security/nuke.js';
import { FloodWatch, floodKey, RaidWatch } from '../../src/modules/security/raid.js';
import {
  agePoints,
  hasDigitRun,
  looksRandom,
  type RiskInput,
  scoreMember,
  spamWord,
  storedReasons,
  waveAround,
} from '../../src/modules/security/risk.js';
import { decide, Inbox, joinEmbed, Verifier } from '../../src/modules/security/verification.js';
import type { AuditLogEvent, MemberJoin, RoleRef } from '../../src/platform/types.js';
import type { ModuleContext } from '../../src/runtime/module.js';

const guildId = '900000000000000001';
const DAY = 86_400_000;
const base = Date.UTC(2026, 9, 22, 12);

function snowflakeAt(ms: number, n = 0): string {
  return String(((BigInt(ms) - 1_420_070_400_000n) << 22n) + BigInt(n));
}

function input(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    createdAt: new Date(base - 400 * DAY),
    joinedAt: new Date(base),
    hasAvatar: true,
    globalName: 'Lena',
    nick: null,
    username: 'lena',
    displayName: 'Lena',
    waveSize: 0,
    leftAt: null,
    kicks: 0,
    bans: 0,
    inviterAgeHours: null,
    shield: 0,
    raid: false,
    ...overrides,
  };
}

const settings = securityConfig.parse({}).verification;

describe('security config', () => {
  it('has safe defaults and prefixed tables', () => {
    const config = securityConfig.parse({});
    expect(config.verification.enabled).toBe(false);
    expect(config.verification.threshold).toBe(5);
    expect(config.nuke.limits.channelDelete).toBe(3);
    for (const migration of definition.migrations) {
      const tables = [...migration.up.matchAll(/create table (\w+)/g)].map((m) => m[1]);
      for (const table of tables) expect(table?.startsWith('security_')).toBe(true);
    }
  });
});

describe('risk score', () => {
  it('scores a brand new account without picture or name like VintoHelper, a bit sharper', () => {
    const result = scoreMember(
      input({
        createdAt: new Date(base - 2 * 3_600_000),
        hasAvatar: false,
        globalName: null,
        displayName: 'x',
      }),
      settings.weights,
      settings.spamWords,
    );
    expect(result.reasons.map((reason) => reason.key)).toEqual([
      'age',
      'noAvatar',
      'noName',
      'newWithoutAvatar',
    ]);
    expect(result.score).toBe(11);
    expect(decide(result.score, settings, false)).toBe('pending');
  });

  it('flags a two week old account without picture and name at the threshold', () => {
    const result = scoreMember(
      input({ createdAt: new Date(base - 10 * DAY), hasAvatar: false, globalName: null }),
      settings.weights,
      settings.spamWords,
    );
    expect(result.score).toBe(5);
  });

  it('gives old accounts with a picture a bonus and never goes below zero', () => {
    const result = scoreMember(input(), settings.weights, settings.spamWords);
    expect(result.reasons).toEqual([{ key: 'established' }]);
    expect(result.score).toBe(0);
    expect(decide(0, settings, false)).toBe('clear');
    expect(decide(0, settings, true)).toBe('pending');
  });

  it('reads names, history and waves', () => {
    const result = scoreMember(
      input({
        username: 'free_nitro_drop',
        waveSize: 4,
        leftAt: new Date(base - 5 * 60_000),
        kicks: 1,
        bans: 1,
        inviterAgeHours: 3,
      }),
      settings.weights,
      settings.spamWords,
    );
    const keys = result.reasons.map((reason) => reason.key);
    expect(keys).toEqual(
      expect.arrayContaining(['spamName', 'wave', 'rejoin', 'priorKick', 'priorBan', 'newInviter']),
    );
    expect(keys).not.toContain('established');
    expect(result.score).toBe(3 + 4 + 2 + 2 + 4 + 2);
  });

  it('counts Shield reports only from two other communities on', () => {
    const one = scoreMember(input({ shield: 1 }), settings.weights, settings.spamWords);
    expect(one.reasons.map((reason) => reason.key)).not.toContain('shield');
    const two = scoreMember(input({ shield: 2 }), settings.weights, settings.spamWords);
    expect(two.reasons).toContainEqual({ key: 'shield', count: 2 });
    expect(two.score).toBe(settings.weights.shield);
    expect(storedReasons([{ key: 'shield', count: 3 }])).toEqual([{ key: 'shield', count: 3 }]);
  });

  it('lets severe scores go straight to the configured action', () => {
    const strict = { ...settings, severeAction: 'ban' as const, severeScore: 12 };
    expect(decide(12, strict, false)).toBe('severe');
    expect(decide(11, strict, false)).toBe('pending');
  });

  it('spots generated names, number runs and spam words', () => {
    expect(looksRandom('xkqzvbtrwp')).toBe(true);
    expect(looksRandom('a8f3k2l9q1')).toBe(true);
    expect(looksRandom('Christopher')).toBe(false);
    expect(looksRandom('lena')).toBe(false);
    expect(hasDigitRun('lena20041')).toBe(true);
    expect(hasDigitRun('lena2004')).toBe(true);
    expect(hasDigitRun('lena04')).toBe(false);
    expect(spamWord(['FREE N1tro'], ['nitro'])).toBe(null);
    expect(spamWord(['Free Nitro Here'], ['nitro'])).toBe('nitro');
    expect(spamWord(['Støff Admin'], ['admin'])).toBe('admin');
  });

  it('picks the tightest age tier', () => {
    expect(agePoints(10, settings.weights.ageTiers)).toEqual({ points: 6, tier: 24 });
    expect(agePoints(100, settings.weights.ageTiers)).toEqual({ points: 4, tier: 168 });
    expect(agePoints(2000, settings.weights.ageTiers)).toBeNull();
  });

  it('groups joins of similar accounts into a wave', () => {
    const at = base;
    const sample = (userId: string, name: string, createdAgo: number) => ({
      userId,
      at,
      createdAt: at - createdAgo,
      name,
      hasAvatar: false,
    });
    const current = sample('4', 'raider4', 2 * 3_600_000);
    const wave = waveAround(
      [
        sample('1', 'raider1', 3_600_000),
        sample('2', 'raider2', 5_000),
        sample('3', 'oldtimer', 900 * DAY),
      ],
      current,
    );
    expect(wave.map((entry) => entry.userId)).toEqual(['1', '2', '4']);
    expect(waveAround([], current)).toEqual([]);
  });

  it('only trusts stored reasons it knows', () => {
    expect(storedReasons([{ key: 'age', hours: 24 }, { key: 'nope' }, 'x', null])).toEqual([
      { key: 'age', hours: 24 },
    ]);
  });

  it('explains reasons in both languages', () => {
    expect(copy.reason({ key: 'age', hours: 24 })).toBe('account younger than 1 day');
    expect(copy.reason({ key: 'age', hours: 72 })).toBe('account younger than 3 days');
    withLanguage('de', () => {
      expect(copy.reason({ key: 'age', hours: 24 })).toBe('Konto jünger als 1 Tag');
      expect(copy.reason({ key: 'wave', size: 3 })).toBe('kam zusammen mit 2 ähnlichen Konten');
    });
  });
});

describe('captcha', () => {
  it('uses decoy colours that stay apart from the target for colour blind members', () => {
    expect(decoysFor('yellow')).toEqual([targetColors.blue, '#8E8C99']);
    expect(decoysFor('blue')).toEqual([targetColors.yellow, '#8E8C99']);
  });

  it('hides the code between decoys and reads it back in order', () => {
    let i = 0;
    const sequence = [0, 2, 1, 4, 3];
    const random = (max: number) => (sequence[i++ % sequence.length] ?? 0) % max;
    const glyphs = layout('12345', 3, random);
    expect(glyphs).toHaveLength(8);
    expect(readTargets(glyphs)).toBe('12345');
  });

  it('accepts answers with spaces but not wrong lengths', () => {
    expect(matches(' 12 345 ', '12345')).toBe(true);
    expect(matches('1234', '12345')).toBe(false);
    expect(matches('12346', '12345')).toBe(false);
    expect(looksLikeAnswer('123 45')).toBe(true);
    expect(looksLikeAnswer('new')).toBe(true);
    expect(looksLikeAnswer('hello there')).toBe(false);
  });

  it('renders a png with a five digit code', async () => {
    const captcha = await renderCaptcha();
    expect(captcha.code).toMatch(/^\d{5}$/);
    expect(['blue', 'yellow']).toContain(captcha.color);
    expect([...captcha.png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
  });
});

class MemoryStore {
  checks: SecurityCheck[] = [];
  events: SecurityEvent[] = [];
  raid: SecurityRaid | null = null;
  #id = 0;

  async openCheck(input: CheckInput): Promise<SecurityCheck> {
    if (input.status === 'pending') {
      for (const check of this.checks) {
        if (
          check.guildId === input.guildId &&
          check.userId === input.userId &&
          check.status === 'pending'
        )
          check.status = 'released';
      }
    }
    const check: SecurityCheck = {
      id: String(++this.#id),
      guildId: input.guildId,
      userId: input.userId,
      score: input.score,
      reasons: [...input.reasons],
      status: input.status,
      method: input.method,
      code: input.code,
      attempts: 0,
      logChannelId: null,
      logMessageId: null,
      createdAt: new Date(),
      expiresAt: input.expiresAt,
      resolvedAt: null,
    };
    this.checks.unshift(check);
    return check;
  }
  async pending(g: string, u: string) {
    return (
      this.checks.find((c) => c.guildId === g && c.userId === u && c.status === 'pending') ?? null
    );
  }
  async pendingFor(u: string) {
    return this.checks.filter((c) => c.userId === u && c.status === 'pending');
  }
  async pendingAll() {
    return this.checks.filter((c) => c.status === 'pending');
  }
  async check(_g: string, id: string) {
    return this.checks.find((c) => c.id === id) ?? null;
  }
  async recentChecks(g: string) {
    return this.checks.filter((c) => c.guildId === g);
  }
  async attempt(id: string) {
    const check = this.checks.find((c) => c.id === id);
    if (!check) return 0;
    check.attempts++;
    return check.attempts;
  }
  async setCode(id: string, code: string, method: SecurityCheck['method']) {
    const check = this.checks.find((c) => c.id === id);
    if (check) Object.assign(check, { code, method });
  }
  async setLog(id: string, channelId: string, messageId: string) {
    const check = this.checks.find((c) => c.id === id);
    if (check) Object.assign(check, { logChannelId: channelId, logMessageId: messageId });
  }
  async resolve(id: string, status: SecurityCheck['status']) {
    const check = this.checks.find((c) => c.id === id && c.status === 'pending');
    if (!check) return null;
    check.status = status;
    return check;
  }
  async resolveMember(g: string, u: string, status: SecurityCheck['status']) {
    const check = await this.pending(g, u);
    if (!check) return null;
    check.status = status;
    return check;
  }
  async counts() {
    return { checked: this.checks.length, flagged: 2, passed: 0, failed: 0, pending: 0 };
  }
  async history() {
    return { kicks: 0, bans: 0, leftAt: null };
  }
  async event(input: Omit<SecurityEvent, 'id' | 'createdAt'>) {
    const event = { ...input, id: String(this.events.length + 1), createdAt: new Date() };
    this.events.push(event);
    return event;
  }
  async activeRaid() {
    return this.raid && !this.raid.endedAt ? this.raid : null;
  }
  async startRaid(g: string, reason: string, by: string | null, endsAt: Date) {
    if (this.raid && !this.raid.endedAt) {
      this.raid.endsAt = endsAt;
      return { raid: this.raid, created: false };
    }
    this.raid = {
      id: '77',
      guildId: g,
      reason,
      startedBy: by,
      startedAt: new Date(),
      endsAt,
      endedAt: null,
      endedBy: null,
      state: {},
    };
    return { raid: this.raid, created: true };
  }
  async setRaidState(_id: string, state: SecurityRaid['state']) {
    if (this.raid) this.raid.state = state;
  }
  async endRaid(_g: string, by: string | null) {
    if (!this.raid || this.raid.endedAt) return null;
    this.raid.endedAt = new Date();
    this.raid.endedBy = by;
    return this.raid;
  }
}

function harness(overrides: Record<string, unknown> = {}) {
  let now = base;
  const clock = () => now;
  const config = securityConfig.parse({
    logChannelId: '500000000000000001',
    verification: { enabled: true },
    raid: { enabled: true, joins: 4, perSeconds: 10, waveSize: 9, floodMembers: 3 },
    nuke: { enabled: true },
    honeypot: { enabled: true, channelIds: ['600000000000000001'] },
    ...overrides,
  });
  const automodSettings = automodConfig.parse({
    raid: { gateRoleId: '700000000000000001', gateChannelId: '700000000000000002' },
  });
  const roles: RoleRef[] = [
    {
      id: '800000000000000001',
      name: 'Admin',
      color: 0,
      position: 5,
      permissions: '8',
      managed: false,
      hoist: false,
      mentionable: false,
    },
    {
      id: '800000000000000002',
      name: 'Maxwell',
      color: 0,
      position: 10,
      permissions: '8',
      managed: false,
      hoist: false,
      mentionable: false,
    },
    {
      id: '800000000000000003',
      name: 'Owner',
      color: 0,
      position: 20,
      permissions: '8',
      managed: false,
      hoist: false,
      mentionable: false,
    },
  ];
  const memberRoles = new Map<string, string[]>([['1', ['800000000000000002']]]);
  const platform = {
    selfId: '1',
    channelInGuild: async () => true,
    member: vi.fn(async (_g: string, userId: string) => ({
      guildId,
      user: {
        id: userId,
        username: `user${userId}`,
        displayName: `User ${userId}`,
        bot: userId === '42',
        avatarUrl: '',
      },
      nick: null,
      roles: memberRoles.get(userId) ?? [],
      joinedAt: new Date(now),
      timeoutUntil: null,
    })),
    user: vi.fn(async (userId: string) => ({
      id: userId,
      username: `user${userId}`,
      displayName: `User ${userId}`,
      bot: userId === '42',
      avatarUrl: '',
    })),
    guild: vi.fn(async () => ({ id: guildId, name: 'Lab', memberCount: 10, iconUrl: null })),
    sendDirect: vi.fn(async () => true),
    send: vi.fn(async () => '990000000000000001'),
    edit: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    addRole: vi.fn(async () => {}),
    removeRole: vi.fn(async () => {}),
    roles: vi.fn(async () => roles),
    channels: vi.fn(async () => [{ id: '650000000000000001', rateLimitPerUser: 0 }]),
    editChannel: vi.fn(async () => {}),
    setInvitesPaused: vi.fn(async () => true),
    guildOwner: vi.fn(async () => '3'),
    kick: vi.fn(async () => {}),
    ban: vi.fn(async () => {}),
    hasPermissions: vi.fn(async (_g: string, userId: string) => userId === '5'),
    createChannel: vi.fn(async () => '660000000000000001'),
  };
  const jobs = { enqueue: vi.fn(async () => '1') };
  const sql = (async () => []) as unknown as Sql;
  const services = {
    platform,
    jobs,
    sql,
    settings: {
      config: async (_g: string, key: string, schema: { parse(v: unknown): unknown }) =>
        key === 'automod' ? automodSettings : schema.parse({}),
      enabled: async () => false,
    },
    guilds: { prefix: async () => 'm!' },
    log: { warn() {}, info() {}, debug() {}, error() {} },
  };
  const ctx = {
    config: async () => config,
    enabled: async () => true,
    schedule: vi.fn(async () => '1'),
    record: vi.fn(async () => '1'),
    update: vi.fn(async () => {}),
    services,
  } as unknown as ModuleContext<typeof securityConfig>;
  const store = new MemoryStore();
  const automod = {
    hold: vi.fn(async () => true),
    resolveHeld: vi.fn(async () => []),
    activeIncident: vi.fn(async () => null),
  };
  const backups = {
    findChannel: vi.fn(async (_g: string, id: string) => ({ snapshotId: '31', channel: { id } })),
    findRole: vi.fn(async (_g: string, id: string) =>
      id.startsWith('2') ? { snapshotId: '31', role: { id } } : null,
    ),
  };
  const securityStore = store as unknown as SecurityStore;
  const guard = new Guard(ctx, automod as unknown as AutomodStore);
  const raid = new RaidWatch(ctx, securityStore, automod as unknown as AutomodStore, guard, clock);
  const verifier = new Verifier(ctx, securityStore, guard, raid, new Inbox(), clock);
  raid.hooks = { recheck: (g, ids) => verifier.recheck(g, ids) };
  const nuke = new NukeWatch(ctx, securityStore, backups as unknown as BackupStore, guard, clock);
  const honeypot = new Honeypot(ctx, securityStore, guard, clock);
  return {
    ctx,
    config,
    platform,
    jobs,
    store,
    automod,
    raid,
    verifier,
    nuke,
    honeypot,
    memberRoles,
    tick: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

function join(
  userId: string,
  at: number,
  createdAgo: number,
  extra: Partial<MemberJoin['user']> = {},
): MemberJoin {
  return {
    guildId,
    joinedAt: new Date(at),
    user: {
      id: snowflakeAt(at - createdAgo, Number(userId) % 4000),
      username: `member${userId}`,
      displayName: `Member ${userId}`,
      bot: false,
      avatarUrl: '',
      hasAvatar: false,
      globalName: null,
      ...extra,
    },
  };
}

describe('verification', () => {
  it('lets low scores through and logs them', async () => {
    const h = harness();
    await h.verifier.onJoin(join('1001', base, 500 * DAY, { hasAvatar: true, globalName: 'Lena' }));
    expect(h.store.checks[0]?.status).toBe('clear');
    expect(h.platform.sendDirect).not.toHaveBeenCalled();
    expect(h.platform.send).toHaveBeenCalledWith(
      '500000000000000001',
      expect.objectContaining({
        embeds: [expect.objectContaining({ title: 'Welcome Member 1001' })],
      }),
    );
  });

  it('holds risky members, sends a captcha and lets them in with the right code', async () => {
    const h = harness();
    const member = join('1002', base, 3_600_000);
    await h.verifier.onJoin(member);
    const check = h.store.checks[0];
    expect(check?.status).toBe('pending');
    expect(check?.method).toBe('dm');
    expect(h.platform.addRole).toHaveBeenCalledWith(
      guildId,
      member.user.id,
      '700000000000000001',
      expect.any(String),
    );
    expect(h.automod.hold).toHaveBeenCalledWith(guildId, member.user.id, null, 'verify');
    expect(h.platform.sendDirect).toHaveBeenCalledWith(
      member.user.id,
      expect.objectContaining({ files: [expect.objectContaining({ name: 'captcha.png' })] }),
    );
    expect(h.ctx.schedule).toHaveBeenCalledWith('verify.expire', expect.any(Object));
    expect(h.verifier.inbox.has(member.user.id)).toBe(true);

    const replies: string[] = [];
    const reply = async (text: string) => replies.push(text);
    await h.verifier.answer(member.user.id, '00000', null, reply);
    expect(replies.at(-1)).toContain('2 tries left');
    await h.verifier.answer(member.user.id, 'hello', null, reply);
    expect(check?.attempts).toBe(1);
    await h.verifier.answer(member.user.id, check?.code ?? '', null, reply);
    expect(check?.status).toBe('passed');
    expect(h.platform.removeRole).toHaveBeenCalledWith(
      guildId,
      member.user.id,
      '700000000000000001',
      expect.any(String),
    );
    expect(h.automod.resolveHeld).toHaveBeenCalledWith(guildId, [member.user.id], 'let_in', null);
    expect(h.verifier.inbox.has(member.user.id)).toBe(false);
    expect(h.platform.edit).toHaveBeenCalled();
  });

  it('kicks after the last wrong try when set to kick', async () => {
    const h = harness({ verification: { enabled: true, attempts: 2, onExpire: 'kick' } });
    const member = join('1003', base, 3_600_000);
    await h.verifier.onJoin(member);
    const reply = vi.fn(async () => {});
    await h.verifier.answer(member.user.id, '11111', null, reply);
    await h.verifier.answer(member.user.id, '22222', null, reply);
    expect(h.store.checks[0]?.status).toBe('failed');
    expect(h.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'moderation.action',
        payload: expect.objectContaining({ action: 'kick', source: 'security' }),
      }),
    );
  });

  it('falls back to the gate channel when DMs are closed', async () => {
    const h = harness();
    h.platform.sendDirect.mockResolvedValue(false);
    const member = join('1004', base, 3_600_000);
    await h.verifier.onJoin(member);
    expect(h.store.checks[0]?.method).toBe('channel');
    expect(h.platform.send).toHaveBeenCalledWith(
      '700000000000000002',
      expect.objectContaining({ mentionUsers: [member.user.id] }),
    );
  });

  it('expires open checks and marks members who leave', async () => {
    const h = harness();
    const first = join('1005', base, 3_600_000);
    await h.verifier.onJoin(first);
    const check = h.store.checks[0];
    await h.verifier.expire({
      id: '1',
      kind: 'security.verify.expire',
      guildId,
      payload: { checkId: check?.id },
      runAt: new Date(),
      attempts: 1,
    });
    expect(check?.status).toBe('expired');

    const second = join('1006', base, 3_600_000);
    await h.verifier.onJoin(second);
    await h.verifier.onLeave(guildId, second.user.id);
    expect(h.store.checks[0]?.status).toBe('left');
  });

  it('bans straight away when the score is severe', async () => {
    const h = harness({ verification: { enabled: true, severeScore: 10, severeAction: 'ban' } });
    await h.verifier.onJoin(join('1007', base, 3_600_000));
    expect(h.store.checks[0]?.status).toBe('failed');
    expect(h.platform.sendDirect).not.toHaveBeenCalled();
    expect(h.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ action: 'ban' }) }),
    );
  });

  it('builds the log embed with status and reasons', () => {
    const embed = joinEmbed('5', 'Lena', null, 6, ['account younger than 1 day'], 'pending');
    expect(embed.fields?.map((field) => field.value)).toEqual([
      '<@5> (5)',
      'Waiting for captcha',
      '6',
      'account younger than 1 day',
    ]);
  });
});

describe('raid watch', () => {
  it('turns raid mode on for a join burst and checks everyone after that', async () => {
    const h = harness({
      raid: { enabled: true, joins: 3, perSeconds: 10, waveSize: 9, pauseInvites: true },
    });
    const members = ['2001', '2002', '2003'].map((id, index) =>
      join(id, base + index * 1000, 400 * DAY, { hasAvatar: true, globalName: `Name${id}` }),
    );
    for (const member of members) {
      h.tick(1000);
      await h.raid.onJoin(member);
      await h.verifier.onJoin(member);
    }
    expect(h.store.raid?.reason).toBe('joins');
    expect(h.platform.setInvitesPaused).toHaveBeenCalledWith(guildId, true, expect.any(String));
    expect(h.store.raid?.state).toEqual({ pausedInvites: true });
    expect(await h.raid.active(guildId)).toBe(true);
    const latest = h.store.checks.find((check) => check.userId === members[2]?.user.id);
    expect(latest?.status).toBe('pending');

    await h.raid.end(guildId, { id: '9' });
    expect(h.platform.setInvitesPaused).toHaveBeenLastCalledWith(
      guildId,
      false,
      expect.any(String),
    );
    expect(h.store.raid?.endedBy).toBe('9');
  });

  it('does nothing below the burst size or with old joins', async () => {
    const h = harness({ raid: { enabled: true, joins: 3, perSeconds: 10, waveSize: 9 } });
    await h.raid.onJoin(join('2101', base, 400 * DAY, { hasAvatar: true }));
    h.tick(20_000);
    await h.raid.onJoin(join('2102', base + 20_000, 400 * DAY, { hasAvatar: true }));
    h.tick(20_000);
    await h.raid.onJoin(join('2103', base + 40_000, 400 * DAY, { hasAvatar: true }));
    expect(h.store.raid).toBeNull();
  });

  it('turns raid mode on when new members post the same thing', async () => {
    const h = harness({ raid: { enabled: true, floodMembers: 3, floodSeconds: 30 } });
    for (const id of ['3001', '3002', '3003']) {
      await h.raid.onJoin(join(id, base, 400 * DAY, { hasAvatar: true }));
    }
    for (const id of ['3001', '3002', '3003']) {
      h.tick(500);
      await h.raid.onMessage({
        id: `m${id}`,
        channelId: '1',
        guildId,
        content: 'JOIN my server https://spam.example/x?ref=1',
        author: join(id, base, 400 * DAY).user,
        memberRoles: [],
        fromWebhook: false,
        attachments: [],
        embeds: [],
        mentionUsers: [],
        mentionRoles: [],
        mentionEveryone: false,
        replyTo: null,
        createdAt: new Date(h.now()),
      });
    }
    expect(h.store.raid?.reason).toBe('flood');
  });

  it('normalizes flood keys', () => {
    expect(floodKey('Hey <@123> look https://a.b/c?x=1', 0)).toBe(
      floodKey('hey <@999> look https://a.b/c?y=2', 0),
    );
    expect(floodKey('hi', 0)).toBeNull();
    expect(floodKey('anything', 6)).toBe('@mentions');
    const flood = new FloodWatch();
    expect(flood.add(guildId, 'k', '1', 0, 10)).toEqual(['1']);
    expect(flood.add(guildId, 'k', '2', 5_000, 10)).toEqual(['1', '2']);
    expect(flood.add(guildId, 'k', '3', 20_000, 10)).toEqual(['3']);
  });
});

function audit(
  action: number,
  actorId: string,
  targetId: string,
  extra: Partial<AuditLogEvent> = {},
): AuditLogEvent {
  return { id: '1', guildId, action, actorId, targetId, reason: null, changes: [], ...extra };
}

describe('nuke watch', () => {
  it('stops a member who deletes channels too fast and restores them', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness();
    h.memberRoles.set('7', ['800000000000000001']);
    for (const id of ['11', '12', '13']) {
      h.tick(1000);
      await h.nuke.onAuditLog(audit(12, '7', id));
    }
    expect(h.jobs.enqueue).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    vi.useRealTimers();
    expect(h.platform.removeRole).toHaveBeenCalledWith(
      guildId,
      '7',
      '800000000000000001',
      expect.any(String),
    );
    expect(h.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'backups.restore',
        payload: expect.objectContaining({
          snapshotId: '31',
          scope: 'pick',
          channels: ['11', '12', '13'],
        }),
      }),
    );
    expect(h.store.events.at(-1)?.kind).toBe('nuke');
  });

  it('restores what the actor deletes after being caught in one go', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness();
    h.memberRoles.set('7', ['800000000000000003']);
    for (const id of ['11', '12', '13']) await h.nuke.onAuditLog(audit(12, '7', id));
    await vi.advanceTimersByTimeAsync(2_000);
    await h.nuke.onAuditLog(audit(12, '7', '14'));
    for (const id of ['21', '22']) await h.nuke.onAuditLog(audit(32, '7', id));
    await vi.advanceTimersByTimeAsync(4_000);
    expect(h.jobs.enqueue).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();
    expect(h.jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(h.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'backups.restore',
        payload: expect.objectContaining({
          scope: 'pick',
          channels: ['11', '12', '13', '14'],
          roles: ['21', '22'],
        }),
      }),
    );
    expect(h.store.events.filter((event) => event.kind === 'nuke')).toHaveLength(1);
  });

  it('stops the actor again when they keep going', async () => {
    const h = harness();
    h.memberRoles.set('7', ['800000000000000001']);
    for (const id of ['11', '12', '13']) await h.nuke.onAuditLog(audit(12, '7', id));
    expect(h.platform.removeRole).toHaveBeenCalledTimes(1);
    h.tick(1_000);
    await h.nuke.onAuditLog(audit(32, '7', '21'));
    expect(h.platform.removeRole).toHaveBeenCalledTimes(1);
    h.tick(5_000);
    await h.nuke.onAuditLog(audit(32, '7', '22'));
    expect(h.platform.removeRole).toHaveBeenCalledTimes(2);
    expect(h.store.events.filter((event) => event.kind === 'nuke')).toHaveLength(1);
  });

  it('does not restore an earlier attack again on the next one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness();
    h.memberRoles.set('7', ['800000000000000003']);
    for (const id of ['11', '12', '13']) await h.nuke.onAuditLog(audit(12, '7', id));
    await vi.advanceTimersByTimeAsync(5_000);
    h.tick(61_000);
    for (const id of ['21', '22', '23']) await h.nuke.onAuditLog(audit(32, '7', id));
    await h.nuke.onAuditLog(audit(12, '7', '11'));
    await vi.advanceTimersByTimeAsync(5_000);
    vi.useRealTimers();
    const calls = h.jobs.enqueue.mock.calls as unknown as [{ payload: unknown }][];
    const payloads = calls.map(([job]) => job.payload);
    expect(payloads).toEqual([
      expect.objectContaining({ channels: ['11', '12', '13'], roles: [] }),
      expect.objectContaining({ channels: [], roles: ['21', '22', '23'] }),
    ]);
  });

  it('kicks bots and leaves owners, trusted people and slow actors alone', async () => {
    const h = harness({ nuke: { enabled: true, trustedUserIds: ['8'] } });
    for (const actor of ['3', '8']) {
      for (const id of ['21', '22', '23', '24']) await h.nuke.onAuditLog(audit(32, actor, id));
    }
    expect(h.platform.removeRole).not.toHaveBeenCalled();
    for (const id of ['31', '32', '33']) {
      h.tick(40_000);
      await h.nuke.onAuditLog(audit(12, '9', id));
    }
    expect(h.store.events).toHaveLength(0);
    for (const id of ['41', '42']) await h.nuke.onAuditLog(audit(28, '42', id));
    expect(h.platform.kick).toHaveBeenCalledWith(guildId, '42', expect.any(String));
  });

  it('does not touch roles above Maxwell', async () => {
    const h = harness();
    h.memberRoles.set('7', ['800000000000000003']);
    for (const id of ['51', '52', '53', '54', '55']) await h.nuke.onAuditLog(audit(22, '7', id));
    expect(h.platform.removeRole).not.toHaveBeenCalled();
    expect(h.store.events.at(-1)?.detail).toMatchObject({ failed: true });
  });

  it('notices dangerous permission grants', () => {
    const roles = [
      {
        id: 'r1',
        name: 'x',
        color: 0,
        position: 1,
        permissions: '8',
        managed: false,
        hoist: false,
        mentionable: false,
      },
    ];
    expect(
      grantsDanger(
        audit(31, '7', 'r1', { changes: [{ key: 'permissions', before: '0', after: '8' }] }),
        roles,
      ),
    ).toBe(true);
    expect(
      grantsDanger(
        audit(31, '7', 'r1', { changes: [{ key: 'permissions', before: '8', after: '8' }] }),
        roles,
      ),
    ).toBe(false);
    expect(
      grantsDanger(
        audit(25, '7', 'u1', { changes: [{ key: '$add', before: null, after: [{ id: 'r1' }] }] }),
        roles,
      ),
    ).toBe(true);
    const counter = new ActionCounter();
    counter.add('a', { at: 0, targetId: '1' }, 1000);
    expect(counter.add('a', { at: 2000, targetId: '2' }, 1000)).toHaveLength(1);
  });
});

describe('honeypot', () => {
  const message = (authorId: string, channelId = '600000000000000001') => ({
    id: 'm1',
    channelId,
    guildId,
    content: 'free stuff',
    author: { id: authorId, username: 'spam', displayName: 'spam', bot: false, avatarUrl: '' },
    memberRoles: [],
    fromWebhook: false,
    attachments: [],
    embeds: [],
    mentionUsers: [],
    mentionRoles: [],
    mentionEveryone: false,
    replyTo: null,
    createdAt: new Date(base),
  });

  it('removes whoever posts in the trap channel once', async () => {
    const h = harness();
    expect(await h.honeypot.onMessage(message('6'))).toBe(true);
    expect(await h.honeypot.onMessage(message('6'))).toBe(true);
    expect(h.platform.delete).toHaveBeenCalledTimes(2);
    const calls = h.jobs.enqueue.mock.calls as unknown as [{ kind: string }][];
    const softbans = calls.filter(([job]) => job.kind === 'moderation.action');
    expect(softbans).toHaveLength(2);
    expect(h.store.events).toHaveLength(1);
  });

  it('ignores mods and other channels', async () => {
    const h = harness();
    expect(await h.honeypot.onMessage(message('5'))).toBe(false);
    expect(await h.honeypot.onMessage(message('6', '1'))).toBe(false);
    expect(h.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('springs on the trap role', async () => {
    const h = harness({
      honeypot: { enabled: true, roleId: '880000000000000001', action: 'quarantine' },
    });
    await h.honeypot.onMemberUpdate({
      guildId,
      user: { id: '6', username: 'x', displayName: 'x', bot: false, avatarUrl: '' },
      nick: null,
      roles: ['880000000000000001'],
      timeoutUntil: null,
      before: { nick: null, roles: [], timeoutUntil: null },
    });
    expect(h.automod.hold).toHaveBeenCalledWith(guildId, '6', null, 'honeypot');
  });

  it('creates a trap channel and switches the honeypot on', async () => {
    const h = harness({ honeypot: { enabled: false } });
    expect(await h.honeypot.setup(guildId, { id: '9' })).toBe('660000000000000001');
    expect(h.ctx.update).toHaveBeenCalledWith(
      guildId,
      { honeypot: expect.objectContaining({ enabled: true, channelIds: ['660000000000000001'] }) },
      { id: '9' },
      expect.any(String),
    );
  });
});
