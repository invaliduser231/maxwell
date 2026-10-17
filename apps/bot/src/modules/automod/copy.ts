import { localized } from '../../i18n/localized.js';
import { code } from '../../ui/format.js';
import de from './copy.de.js';
import type { AutomodRuleKey, HoldReason } from './types.js';

export const ruleNames: Record<AutomodRuleKey, string> = {
  spam: 'Spam',
  invites: 'Invite links',
  links: 'Links',
  mentions: 'Mass mentions',
  caps: 'Caps',
  words: 'Word list',
  repeats: 'Repeated messages',
  emoji: 'Emoji spam',
  newAccountLinks: 'Links from new accounts',
};

const en = {
  commands: {
    gate: 'The raid shield waiting area.',
    list: 'Who is waiting at the gate.',
    let: 'Lets one member or everyone at the gate in.',
    ban: 'Bans everyone waiting at the gate.',
  },
  rules: { ...ruleNames } as Record<AutomodRuleKey, string>,
  holds: {
    raid: 'raid',
    lockdown: 'lockdown',
    account_age: 'new account',
  } as Record<HoldReason, string>,
  details: {
    spam: (count: number, seconds: number) => `${count} messages in ${seconds}s`,
    invite: (code: string) => `invite ${code}`,
    link: (host: string) => `link to ${host}`,
    mentions: (count: number) => `${count} mentions`,
    caps: (percent: number) => `${percent}% capitals`,
    word: (pattern: string) => `matched ${pattern}`,
    repeats: (count: number) => `same message ${count} times`,
    emoji: (count: number) => `${count} emojis`,
    newAccountLink: (age: string) => `link from an account ${age} old`,
  },
  actions: {
    delete: 'Message deleted',
    warn: 'Warned',
    timeout: (duration: string) => `Timed out for ${duration}`,
    kick: 'Kicked',
    ban: 'Banned',
    logOnly: 'None, log only',
  },
  theCommunity: 'the community',
  warn: (who: string, rule: string) => `${who}, that message broke the **${rule}** rule here.`,
  dmTimeout: (guild: string, duration: string, rule: string) =>
    `You were timed out in **${guild}** for ${duration}. Reason: ${rule}.`,
  dmKick: (guild: string, rule: string) => `You were kicked from **${guild}**. Reason: ${rule}.`,
  dmBan: (guild: string, rule: string) => `You were banned from **${guild}**. Reason: ${rule}.`,
  dmFooter: 'Questions go to the server staff, not to me.',
  warnReason: (rule: string, detail: string) =>
    detail ? `AutoMod: ${rule}, ${detail}` : `AutoMod: ${rule}`,
  logTitle: (rule: string, logOnly: boolean) => (logOnly ? `${rule} (log only)` : `${rule} caught`),
  logWhere: (who: string, channel: string) => `${who} in ${channel}`,
  logAction: 'Action',
  logFooter: (userId: string, messageId: string) => `User ${userId} / Message ${messageId}`,

  raidAlert: (joins: number, seconds: number, until: string) =>
    [
      '> [!CAUTION]',
      `> Raid shield is up. **${joins}** joins in ${seconds} seconds.`,
      `New joins wait at the gate until ${until}.`,
    ].join('\n'),
  raidNoGate: 'No gate role is set, so nobody is held. Pick one in the dashboard.',
  gateHint: (prefix: string) => `${code(`${prefix}gate list`)} shows who is waiting.`,
  lockdownStarted: (until: string) => `Lockdown until ${until}. New joins wait at the gate.`,
  lockdownEnded: (held: number) =>
    held === 0
      ? 'Lockdown over. Nobody is left at the gate.'
      : `Lockdown over. **${held}** still waiting at the gate.`,

  gateTitle: 'At the gate',
  gateIncident: (held: number, until: string | null) =>
    until ? `**${held}** held. Lockdown until ${until}.` : `**${held}** held.`,
  gateLine: (who: string, when: string, reason: string) => `${who}  ${when}  *${reason}*`,
  gateEmpty: [
    'Nobody is waiting at the gate.',
    'The gate is empty.',
    'Nobody at the gate. Quiet day.',
  ],
  notHeld: (who: string) => `${who} isn't waiting at the gate.`,
  letInOne: (who: string) => `Let ${who} in.`,
  letInAll: (count: number) =>
    count === 1 ? 'Let **1** member in.' : `Let **${count}** members in.`,
  letInPartial: (done: number, total: number) =>
    `Let **${done}** of ${total} in. I couldn't remove the gate role from the rest.`,
  noGateRole: 'No gate role is set. Pick one in the dashboard.',
  banConfirm: (count: number, ok: string) =>
    [
      '> [!WARNING]',
      `> This bans **${count}** ${count === 1 ? 'member' : 'members'} held at the gate.`,
      `React with ${ok} within 30 seconds to go ahead.`,
    ].join('\n'),
  banTimeout: 'No answer, so nothing happened.',
  bannedAll: (count: number) =>
    count === 1
      ? 'Banned **1** member from the gate.'
      : `Banned **${count}** members from the gate.`,
  bannedPartial: (done: number, total: number) =>
    `Banned **${done}** of ${total}. The rest probably have roles above mine.`,
};

export type AutomodCopy = typeof en;

export const copy = localized(en, { de });

export const audit = {
  reason: (rule: string) => `AutoMod: ${rule}`,
  auditWarn: (name: string, rule: string) => `AutoMod warned ${name} (${rule})`,
  auditTimeout: (name: string, duration: string, rule: string) =>
    `AutoMod timed out ${name} for ${duration} (${rule})`,
  auditKick: (name: string, rule: string) => `AutoMod kicked ${name} (${rule})`,
  auditBan: (name: string, rule: string) => `AutoMod banned ${name} (${rule})`,
  auditIncident: (joins: number, seconds: number) =>
    `Raid shield started a lockdown after ${joins} joins in ${seconds}s`,
  auditLockdown: (duration: string) => `Started a lockdown for ${duration}`,
  auditLockdownEnd: 'Ended the lockdown',
  auditLetIn: (count: number) =>
    count === 1 ? 'Let 1 member in from the gate' : `Let ${count} members in from the gate`,
  auditBanAll: (count: number) =>
    count === 1 ? 'Banned 1 member from the gate' : `Banned ${count} members from the gate`,
  auditGateSetup: 'Set up the gate role',
  gateRoleName: 'Gate',
  gateReason: 'Raid shield gate',
  banReason: 'Raid shield: banned from the gate',
};
