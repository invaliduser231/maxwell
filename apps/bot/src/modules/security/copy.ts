import { mention } from '../../commands/mentions.js';
import { catalog, type Vars } from '../../i18n/catalog.js';
import en from '../../locales/en/security.json' with { type: 'json' };
import { andList, escapeMarkdown, plural, subtext } from '../../ui/format.js';
import type { RiskReason } from './risk.js';

function reasonVars(reason: RiskReason): Vars {
  switch (reason.key) {
    case 'age':
      return reason.hours % 24 !== 0
        ? { key: 'ageHours', count: reason.hours }
        : { key: 'ageDays', count: reason.hours / 24 };
    case 'spamName':
      return { key: reason.key, word: reason.word };
    case 'wave':
      return { key: reason.key, count: reason.size - 1 };
    case 'rejoin':
      return { key: reason.key, count: reason.minutes };
    case 'priorKick':
    case 'priorBan':
    case 'shield':
      return { key: reason.key, times: reason.count };
    default:
      return { key: reason.key };
  }
}

function named<K extends string>(
  names: readonly string[],
  labels: Record<K, () => string>,
  keys: Record<K, string>,
): string {
  return andList(names.map((name) => (name in keys ? labels[name as K]() : name)));
}

export const copy = catalog('security', en, (m) => ({
  reason: (reason: RiskReason) => m.reason(reasonVars(reason)),
  log: {
    title: (name: string) => m.log.title({ name }),
    flaggedChannel: (channelId: string) =>
      m.log.flaggedChannel({ channel: mention.channel(channelId) }),
    severe: (action: string) => m.log.severe({ action }),
    resolved: (userId: string, status: string) =>
      m.log.resolved({ user: mention.user(userId), status }),
  },
  dm: {
    title: (guild: string) => m.dm.title({ guild }),
    intro: (color: string) => m.dm.intro({ color: escapeMarkdown(color) }),
    how: (prefix: string) => subtext(m.dm.how({ prefix })),
    expires: (until: string) => m.dm.expires({ until }),
    wrong: (left: number) => m.dm.wrong({ left }),
    passed: (guild: string) => m.dm.passed({ guild: escapeMarkdown(guild) }),
    failed: (guild: string) => m.dm.failed({ guild }),
    kicked: (guild: string) => m.dm.kicked({ guild }),
    expired: (guild: string) => m.dm.expired({ guild }),
    expiredKick: (guild: string) => m.dm.expiredKick({ guild }),
    which: (guilds: string) => m.dm.which({ guilds }),
  },
  channel: {
    intro: (userId: string, color: string, prefix: string) =>
      m.channel.intro({ user: mention.user(userId), color: escapeMarkdown(color), prefix }),
  },
  raid: {
    started: {
      joins: (joins: number, seconds: number) => m.raid.started.joins({ joins, seconds }),
      wave: (size: number) => m.raid.started.wave({ size }),
      flood: (members: number) => m.raid.started.flood({ members }),
      manual: (userId: string | null) =>
        m.raid.started.manual({
          by: userId ? 'user' : 'none',
          user: userId ? mention.user(userId) : '',
        }),
    },
    effects: (until: string, paused: boolean, slowmode: number) =>
      subtext(
        m.raid.effects({
          effects: andList(
            [
              m.raid.effectCaptcha(),
              paused ? m.raid.effectPaused() : '',
              slowmode > 0 ? m.raid.effectSlowmode({ seconds: slowmode }) : '',
            ].filter(Boolean),
          ),
          until,
        }),
      ),
    ended: (checked: number) => m.raid.ended({ checked }),
    calmed: (userId: string) => m.raid.calmed({ user: mention.user(userId) }),
    extended: (until: string) => m.raid.extended({ until }),
  },
  nuke: {
    line: (actorId: string, what: string, count: number, seconds: number) =>
      m.nuke.line({
        actor: mention.user(actorId),
        what,
        count: String(count),
        seconds: String(seconds),
      }),
    stripped: (roles: number) => m.nuke.stripped({ roles }),
    restoring: (channels: number, roles: number) => m.nuke.restoring({ channels, roles }),
  },
  honeypot: {
    caught: (userId: string, channelId: string, action: string) =>
      m.honeypot.caught({
        user: mention.user(userId),
        channel: mention.channel(channelId),
        action,
      }),
    caughtRole: (userId: string, action: string) =>
      m.honeypot.caughtRole({ user: mention.user(userId), action }),
  },
  incident: {
    ended: (kind: string, minutes: number) => m.incident.ended({ kind, minutes }),
    parts: {
      joins: (n: number) => m.incident.parts.joins({ n }),
      bans: (n: number) => m.incident.parts.bans({ n }),
      kicks: (n: number) => m.incident.parts.kicks({ n }),
      timeouts: (n: number) => m.incident.parts.timeouts({ n }),
      deleted: (n: number) => m.incident.parts.deleted({ n }),
      hits: (n: number) => m.incident.parts.hits({ n }),
      channels: (n: number) => m.incident.parts.channels({ n }),
      roles: (n: number) => m.incident.parts.roles({ n }),
    },
    replay: (url: string) => m.incident.replay({ url }),
  },
  status: {
    verification: (on: boolean, threshold: number) =>
      m.status.verification({ on: on ? 'yes' : 'no', threshold }),
    raid: (on: boolean, active: string | null) =>
      m.status.raid({ state: active ? 'active' : on ? 'on' : 'off', until: active ?? '' }),
    nuke: (on: boolean) => m.status.nuke({ on: on ? 'yes' : 'no' }),
    honeypot: (on: boolean, channels: number) =>
      m.status.honeypot({ on: on ? 'yes' : 'no', channels }),
    pending: (count: number) => m.status.pending({ count }),
  },
  check: {
    title: (score: number) => m.check.title({ score: String(score) }),
    line: (severity: string, text: string) =>
      m.check.line({ severity: escapeMarkdown(severity), text }),
    more: (count: number) => m.check.more({ count }),
    fixHint: (url: string | null) => m.check.fixHint({ link: url ? 'yes' : 'no', url: url ?? '' }),
    findings: {
      securityOff: () => m.check.findings.securityOff(),
      everyone: (names: readonly string[]) =>
        m.check.findings.everyone({
          permissions: named(names, m.permissionNames, en.permissionNames),
        }),
      botPosition: (names: readonly string[]) =>
        m.check.findings.botPosition({ roles: andList(names.slice(0, 3)) }),
      botAdmin: (names: readonly string[]) => m.check.findings.botAdmin({ role: names[0] ?? '' }),
      nukeOff: () => m.check.findings.nukeOff(),
      automodOff: () => m.check.findings.automodOff(),
      automodRules: (names: readonly string[]) =>
        m.check.findings.automodRules({ rules: named(names, m.ruleNames, en.ruleNames) }),
      raidOff: () => m.check.findings.raidOff(),
      verificationOff: () => m.check.findings.verificationOff(),
      adminRoles: (names: readonly string[]) =>
        m.check.findings.adminRoles({ count: names.length, roles: andList(names.slice(0, 5)) }),
      modRoles: (names: readonly string[]) =>
        m.check.findings.modRoles({ roles: andList(names.slice(0, 5)) }),
      securityLog: () => m.check.findings.securityLog(),
      modLog: () => m.check.findings.modLog(),
    },
  },
  replies: {
    passed: (userId: string) => m.replies.passed({ user: mention.user(userId) }),
    notPending: (userId: string) => m.replies.notPending({ user: mention.user(userId) }),
    honeypotMade: (channelId: string) =>
      m.replies.honeypotMade({ channel: mention.channel(channelId) }),
    notBanned: (userId: string) => m.replies.notBanned({ user: mention.user(userId) }),
    shared: (userId: string) => m.replies.shared({ user: mention.user(userId) }),
    unshared: (userId: string) => m.replies.unshared({ user: mention.user(userId) }),
    notShared: (userId: string) => m.replies.notShared({ user: mention.user(userId) }),
  },
}));

export const reasons = {
  gate: 'Security check',
  passed: 'Passed the security check',
  failed: 'Failed the captcha',
  expired: 'Did not answer the captcha in time',
  severe: (score: number) => `Risk score ${score}`,
  honeypot: 'Posted in the honeypot channel',
  honeypotRole: 'Took the honeypot role',
  softbanLift: 'Honeypot cleanup',
  nuke: (what: string, count: number) => `Anti-nuke: ${what} ${count} times`,
  raidSlowmode: 'Raid mode slowmode',
  raidInvites: 'Raid mode',
  raidOver: 'Raid mode over',
  incidentUndo: (id: string) => `Undone after security incident #${id}`,
  honeypotChannel: 'Honeypot channel',
  channelName: 'do-not-post',
  check: 'Security check fix',
  checkUndo: 'Security check fix undone',
};

export const audit = {
  raidStarted: (reason: string) => `Raid mode on (${reason})`,
  raidEnded: 'Raid mode off',
  passed: (name: string) => `Let ${name} through the security check`,
  honeypot: 'Created a honeypot channel',
  shieldRemoved: 'Took a member out of Maxwell Shield',
  checkEveryone: 'Security check: removed dangerous permissions from @everyone',
  checkBotAdmin: (role: string) => `Security check: removed Administrator from ${role}`,
  incidentUndo: (id: string, count: number) =>
    `Undid ${plural(count, 'action')} from security incident #${id}`,
};
