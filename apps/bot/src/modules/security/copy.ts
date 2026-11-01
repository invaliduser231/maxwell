import type { FindingKey, Severity } from '@maxwell/core/modules/security-check';
import { mention } from '../../commands/mentions.js';
import { localized } from '../../i18n/localized.js';
import { andList, bold, code, lines, plural, subtext } from '../../ui/format.js';
import type { TargetColor } from './captcha.js';
import de from './copy.de.js';
import type { RiskReason } from './risk.js';

function span(hours: number): string {
  if (hours % 24 !== 0) return plural(hours, 'hour');
  return plural(hours / 24, 'day');
}

const permissionNames: Record<string, string> = {
  Administrator: 'Administrator',
  ManageGuild: 'Manage Server',
  ManageRoles: 'Manage Roles',
  ManageChannels: 'Manage Channels',
  ManageWebhooks: 'Manage Webhooks',
  BanMembers: 'Ban Members',
  KickMembers: 'Kick Members',
  MentionEveryone: 'Mention @everyone',
};

const ruleNames: Record<string, string> = {
  spam: 'spam',
  mentions: 'mass mentions',
  newAccountLinks: 'links from new accounts',
  invites: 'invite links',
};

const named = (names: readonly string[], table: Record<string, string>) =>
  andList(names.map((name) => table[name] ?? name));

const en = {
  colors: { blue: 'blue', yellow: 'yellow' } as Record<TargetColor, string>,
  reason: (reason: RiskReason): string => {
    switch (reason.key) {
      case 'age':
        return `account younger than ${span(reason.hours)}`;
      case 'noAvatar':
        return 'no profile picture';
      case 'noName':
        return 'no display name or nickname';
      case 'newWithoutAvatar':
        return 'new account without a picture';
      case 'randomName':
        return 'name looks generated';
      case 'digitName':
        return 'long number in the name';
      case 'spamName':
        return `name contains "${reason.word}"`;
      case 'wave':
        return `joined with ${plural(reason.size - 1, 'similar account')}`;
      case 'rejoin':
        return `came back ${plural(reason.minutes, 'minute')} after leaving`;
      case 'priorKick':
        return `kicked here before (${reason.count})`;
      case 'priorBan':
        return `banned here before (${reason.count})`;
      case 'shield':
        return `reported in ${reason.count} other communities`;
      case 'newInviter':
        return 'invited by a brand new member';
      case 'established':
        return 'old account with a picture';
      case 'raid':
        return 'joined during raid mode';
    }
  },
  log: {
    title: (name: string) => `Welcome ${name}`,
    clear: 'Good to go.',
    flaggedDm: 'Flagged for a check. Maxwell sent a captcha by DM.',
    flaggedChannel: (channelId: string) =>
      `Flagged for a check. DMs are closed, so the captcha went to ${mention.channel(channelId)}.`,
    flaggedNowhere:
      'Flagged for a check, but there was nowhere to send the captcha. Waiting at the gate.',
    severe: (action: string) => `Risk score too high. Maxwell ${action} the account.`,
    user: 'Member',
    verification: 'Check',
    score: 'Risk score',
    reasons: 'Why',
    noReasons: 'Nothing unusual',
    status: {
      clear: 'Passed',
      pending: 'Waiting for captcha',
      passed: 'Passed after captcha',
      failed: 'Failed captcha',
      expired: 'Did not answer in time',
      left: 'Left before answering',
      released: 'Let in by a moderator',
    },
    severeActions: { kick: 'kicked', ban: 'banned', none: 'flagged' },
    resolved: (userId: string, status: string) => `${mention.user(userId)}: ${status}`,
    noGate:
      'Security wanted to hold someone back, but there is no gate role. Set it up on the Security page.',
  },
  dm: {
    title: (guild: string) => `Quick check for ${guild}`,
    intro: (color: string) =>
      lines(
        `Type the ${bold(color)} digits from the picture, from left to right.`,
        'Ignore all other colors.',
      ),
    how: (prefix: string) =>
      subtext(
        `Reply here with just the digits, or use ${code(`${prefix}verify 12345`)}. ${code(`${prefix}verify new`)} gives you a new picture.`,
      ),
    expires: (until: string) => `The code runs out ${until}.`,
    wrong: (left: number) =>
      left === 1 ? "That's not it. One try left." : `That's not it. ${left} tries left.`,
    passed: (guild: string) => `You're in. Welcome to ${bold(guild)}.`,
    failed: (guild: string) => `That was the last try. ${guild} keeps you at the door for now.`,
    kicked: (guild: string) =>
      `That was the last try, so you were removed from ${guild}. You can join again.`,
    expired: (guild: string) => `Time ran out for ${guild}. Ask a moderator to let you in.`,
    expiredKick: (guild: string) =>
      `Time ran out, so you were removed from ${guild}. You can join again.`,
    nothing: 'There is no check waiting for you.',
    which: (guilds: string) =>
      `You have checks waiting in ${guilds}. Answer in the newest one first.`,
    fresh: 'Here is a new picture.',
  },
  channel: {
    intro: (userId: string, color: string, prefix: string) =>
      lines(
        `${mention.user(userId)}, your DMs are closed, so the check happens here.`,
        `Type the ${bold(color)} digits from the picture with ${code(`${prefix}verify 12345`)}.`,
      ),
  },
  raid: {
    started: {
      joins: (joins: number, seconds: number) =>
        `Raid mode is on. ${plural(joins, 'account')} joined in ${seconds} seconds.`,
      wave: (size: number) =>
        `Raid mode is on. ${plural(size, 'similar new account')} joined together.`,
      flood: (members: number) =>
        `Raid mode is on. ${plural(members, 'new member')} posted the same thing at once.`,
      manual: (userId: string | null) =>
        userId ? `Raid mode is on, started by ${mention.user(userId)}.` : 'Raid mode is on.',
      nuke: 'Raid mode is on after a nuke attempt.',
    },
    effects: (until: string, paused: boolean, slowmode: number) =>
      subtext(
        `${andList(
          [
            'every new member gets a captcha',
            paused ? 'invites are paused' : '',
            slowmode > 0 ? `slowmode is ${slowmode}s` : '',
          ].filter(Boolean),
        )}. Ends ${until} unless it stays busy.`,
      ),
    ended: (checked: number) =>
      `Raid mode is off. ${plural(checked, 'member')} went through the check meanwhile.`,
    calmed: (userId: string) => `Raid mode is off, ended by ${mention.user(userId)}.`,
    already: 'Raid mode is already on.',
    notActive: 'Raid mode is not on.',
    extended: (until: string) => `Raid mode stays on until ${until}.`,
  },
  nuke: {
    title: 'Nuke attempt stopped',
    what: {
      channelDelete: 'deleted channels',
      channelCreate: 'created channels',
      roleDelete: 'deleted roles',
      ban: 'banned members',
      kick: 'kicked members',
      webhook: 'created webhooks',
      botAdd: 'added bots',
      dangerousGrant: 'handed out dangerous permissions',
    } as Record<string, string>,
    line: (actorId: string, what: string, count: number, seconds: number) =>
      `${mention.user(actorId)} ${what} ${count} times in ${seconds} seconds.`,
    stripped: (roles: number) => `Took away ${plural(roles, 'role')} with dangerous permissions.`,
    kicked: 'Kicked the account.',
    banned: 'Banned the account.',
    failed: 'Maxwell could not stop the account. Its role is probably above Maxwell.',
    restoring: (channels: number, roles: number) =>
      `Restoring ${plural(channels, 'channel')} and ${plural(roles, 'role')} from the last backup.`,
    noBackup: 'No backup has these channels or roles, so nothing was restored.',
  },
  honeypot: {
    warning: lines(
      'Do not write in this channel.',
      'It is a trap for spam bots. Anything posted here gets the account removed right away.',
    ),
    topic: 'Do not post here. Spam trap.',
    caught: (userId: string, channelId: string, action: string) =>
      `${mention.user(userId)} posted in ${mention.channel(channelId)}. Maxwell ${action} the account.`,
    caughtRole: (userId: string, action: string) =>
      `${mention.user(userId)} took the trap role. Maxwell ${action} the account.`,
    actions: { ban: 'banned', softban: 'removed and cleaned up after', quarantine: 'held back' },
  },
  incident: {
    kinds: {
      raid: 'Raid',
      manual: 'Raid',
      nuke: 'Nuke',
      lockdown: 'Lockdown',
    } as Record<string, string>,
    ended: (kind: string, minutes: number) => `${kind} over after ${plural(minutes, 'minute')}.`,
    parts: {
      joins: (n: number) => plural(n, 'join'),
      bans: (n: number) => plural(n, 'ban'),
      kicks: (n: number) => plural(n, 'kick'),
      timeouts: (n: number) => plural(n, 'timeout'),
      deleted: (n: number) => plural(n, 'deleted message'),
      hits: (n: number) => plural(n, 'AutoMod hit'),
      channels: (n: number) => plural(n, 'channel change'),
      roles: (n: number) => plural(n, 'role change'),
    },
    quiet: 'Nothing else happened.',
    replay: (url: string) => `[Replay and undo](${url})`,
  },
  status: {
    title: 'Security',
    verification: (on: boolean, threshold: number) =>
      on ? `Captcha from risk score ${threshold}` : 'Captcha is off',
    raid: (on: boolean, active: string | null) =>
      active ? `Raid mode on until ${active}` : on ? 'Raid watch on' : 'Raid watch off',
    nuke: (on: boolean): string => (on ? 'Nuke watch on' : 'Nuke watch off'),
    honeypot: (on: boolean, channels: number) =>
      on ? `${plural(channels, 'trap channel')}` : 'No honeypot',
    pending: (count: number) => `${plural(count, 'member')} waiting for a captcha`,
  },
  check: {
    title: (score: number) => `Security check: ${score} of 100`,
    clean: 'Nothing to fix.',
    severity: { high: 'High', medium: 'Medium', low: 'Low' } as Record<Severity, string>,
    line: (severity: string, text: string) => `${bold(severity)}: ${text}`,
    more: (count: number) => `${plural(count, 'more finding')} on the dashboard.`,
    fixHint: (url: string | null) =>
      url
        ? `Fix them on the [Security page](${url}).`
        : 'Fix them on the Security page in the dashboard.',
    findings: {
      securityOff: () => 'Security is off.',
      everyone: (names: readonly string[]) => `@everyone has ${named(names, permissionNames)}.`,
      botPosition: (names: readonly string[]) =>
        `Maxwell's role is below ${andList(names.slice(0, 3))}, so it cannot act on those members.`,
      botAdmin: (names: readonly string[]) => `The bot role ${names[0] ?? ''} has Administrator.`,
      nukeOff: () => 'Nuke watch is off.',
      automodOff: () => 'AutoMod is off.',
      automodRules: (names: readonly string[]) =>
        `AutoMod does not check for ${named(names, ruleNames)}.`,
      raidOff: () => 'Raid watch is off.',
      verificationOff: () => 'The captcha for risky joins is off.',
      adminRoles: (names: readonly string[]) =>
        `${plural(names.length, 'role')} grant Administrator: ${andList(names.slice(0, 5))}.`,
      modRoles: (names: readonly string[]) =>
        `Not set as mod roles in Moderation: ${andList(names.slice(0, 5))}.`,
      securityLog: () => 'Security has no log channel.',
      modLog: () => 'Moderation has no log channel.',
    } as Record<FindingKey, (names: readonly string[]) => string>,
  },
  commands: {
    verify: 'Answers your captcha. Use "new" for a new picture.',
    security: 'Shows what Security is watching.',
    status: 'Shows what Security is watching.',
    raid: 'Turns raid mode on.',
    calm: 'Turns raid mode off.',
    pass: 'Lets a member through the check.',
    honeypot: 'Creates a trap channel for spam bots.',
    shield: 'Shares a ban with Maxwell Shield for 90 days.',
    unshield: 'Takes a member back out of Maxwell Shield.',
    check: 'Rates how well the community is protected.',
  },
  replies: {
    passed: (userId: string) => `${mention.user(userId)} is through.`,
    notPending: (userId: string) => `${mention.user(userId)} is not waiting for a check.`,
    honeypotMade: (channelId: string) => `Trap set in ${mention.channel(channelId)}.`,
    shieldOff: 'Maxwell Shield is off here. It can be turned on in the dashboard under Security.',
    notBanned: (userId: string) => `${mention.user(userId)} is not banned here.`,
    shared: (userId: string) =>
      `${mention.user(userId)} is shared with Maxwell Shield for 90 days.`,
    unshared: (userId: string) => `${mention.user(userId)} is out of Maxwell Shield.`,
    notShared: (userId: string) => `${mention.user(userId)} was not shared from here.`,
  },
};

export type SecurityCopy = typeof en;

export const copy = localized(en, { de });

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
