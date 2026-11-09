import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/automod.json' with { type: 'json' };
import type { AutomodRuleKey } from './types.js';

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
  phishing: 'Phishing links',
};

export const copy = catalog('automod', en, (m) => ({
  details: {
    spam: (count: number, seconds: number) =>
      m.details.spam({ count: String(count), seconds: String(seconds) }),
    invite: (code: string) => m.details.invite({ code }),
    link: (host: string) => m.details.link({ host }),
    mentions: (count: number) => m.details.mentions({ count: String(count) }),
    caps: (percent: number) => m.details.caps({ percent: String(percent) }),
    word: (pattern: string) => m.details.word({ pattern }),
    repeats: (count: number) => m.details.repeats({ count: String(count) }),
    emoji: (count: number) => m.details.emoji({ count: String(count) }),
    newAccountLink: (age: string) => m.details.newAccountLink({ age }),
    phishing: (host: string) => m.details.phishing({ host }),
    lookalike: (host: string, brand: string) => m.details.lookalike({ host, brand }),
  },
  actions: {
    timeout: (duration: string) => m.actions.timeout({ duration }),
  },
  warn: (who: string, rule: string) => m.warn({ who, rule }),
  dmTimeout: (guild: string, duration: string, rule: string) =>
    m.dmTimeout({ guild, duration, rule }),
  dmKick: (guild: string, rule: string) => m.dmKick({ guild, rule }),
  dmBan: (guild: string, rule: string) => m.dmBan({ guild, rule }),
  warnReason: (rule: string, detail: string) =>
    m.warnReason({ rule, detail, hasDetail: detail ? 'yes' : 'no' }),
  logTitle: (rule: string, logOnly: boolean) =>
    m.logTitle({ rule, logOnly: logOnly ? 'yes' : 'no' }),
  logWhere: (who: string, channel: string) => m.logWhere({ who, channel }),
  logFooter: (userId: string, messageId: string) => m.logFooter({ userId, messageId }),
  slowmode: {
    raised: (channel: string, duration: string, rate: number) =>
      m.slowmode.raised({ channel, duration, rate: String(rate) }),
    lowered: (channel: string, duration: string) => m.slowmode.lowered({ channel, duration }),
    restored: (channel: string, duration: string | null) =>
      m.slowmode.restored({
        channel,
        duration: duration ?? '',
        hasDuration: duration ? 'yes' : 'no',
      }),
  },
  raidAlert: (joins: number, seconds: number, until: string) =>
    m.raidAlert({ joins, seconds, until }),
  gateHint: (prefix: string) => m.gateHint({ prefix }),
  lockdownStarted: (until: string) => m.lockdownStarted({ until }),
  lockdownEnded: (held: number) => m.lockdownEnded({ held }),
  gateIncident: (held: number, until: string | null) =>
    m.gateIncident({ held, until: until ?? '', hasUntil: until ? 'yes' : 'no' }),
  gateLine: (who: string, when: string, reason: string) => m.gateLine({ who, when, reason }),
  notHeld: (who: string) => m.notHeld({ who }),
  letInOne: (who: string) => m.letInOne({ who }),
  letInAll: (count: number) => m.letInAll({ count }),
  letInPartial: (done: number, total: number) =>
    m.letInPartial({ done: String(done), total: String(total) }),
  banConfirm: (count: number, ok: string) => m.banConfirm({ count, ok }),
  bannedAll: (count: number) => m.bannedAll({ count }),
  bannedPartial: (done: number, total: number) =>
    m.bannedPartial({ done: String(done), total: String(total) }),
}));

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
  slowmodeReason: 'AutoMod: adaptive slowmode',
  auditLetIn: (count: number) =>
    count === 1 ? 'Let 1 member in from the gate' : `Let ${count} members in from the gate`,
  auditBanAll: (count: number) =>
    count === 1 ? 'Banned 1 member from the gate' : `Banned ${count} members from the gate`,
  auditGateSetup: 'Set up the gate role',
  gateRoleName: 'Gate',
  gateReason: 'Raid shield gate',
  banReason: 'Raid shield: banned from the gate',
};
