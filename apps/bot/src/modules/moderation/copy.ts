import type { CaseAction, EscalationAction } from '@maxwell/core/modules/moderation';
import { catalog } from '../../i18n/catalog.js';
import { withLanguage } from '../../i18n/language.js';
import en from '../../locales/en/moderation.json' with { type: 'json' };
import { code, plural } from '../../ui/format.js';
import { humanDuration } from './text.js';

export const copy = catalog('moderation', en, (m) => ({
  done: {
    ban: (who: string, n: number, duration: string | null) =>
      m.done.ban({
        who,
        n: String(n),
        duration: duration ?? '',
        hasDuration: duration ? 'yes' : 'no',
      }),
    unban: (who: string, n: number) => m.done.unban({ who, n: String(n) }),
    kick: (who: string, n: number) => m.done.kick({ who, n: String(n) }),
    timeout: (who: string, n: number, duration: string) =>
      m.done.timeout({ who, n: String(n), duration }),
    untimeout: (who: string, n: number) => m.done.untimeout({ who, n: String(n) }),
    warn: (who: string, n: number, active: number) => m.done.warn({ who, n: String(n), active }),
  },
  addReason: (prefix: string, n: number) => m.addReason({ prefix, n: String(n) }),
  escalated: (
    active: number,
    days: number,
    who: string,
    action: EscalationAction,
    duration: string | null,
    n: number,
  ) =>
    m.escalated({
      active,
      days,
      who,
      action,
      duration: duration ?? '',
      hasDuration: duration ? 'yes' : 'no',
      n: String(n),
    }),
  escalatedReview: (active: number, days: number, action: EscalationAction, n: number) =>
    m.escalatedReview({ active, days, action, n: String(n) }),
  escalationFailed: (who: string) => m.escalationFailed({ who }),
  reviewSuggestion: (action: EscalationAction, duration: string | null) =>
    m.reviewSuggestion({ action, duration: duration ?? '', hasDuration: duration ? 'yes' : 'no' }),
  reviewApproved: (by: string) => m.reviewApproved({ by }),
  reviewDeclined: (by: string) => m.reviewDeclined({ by }),
  dmAction: {
    warn: () => m.dmAction.warn(),
    timeout: (duration: string) => m.dmAction.timeout({ duration }),
    kick: () => m.dmAction.kick(),
    ban: (duration: string | null) =>
      m.dmAction.ban({ duration: duration ?? '', hasDuration: duration ? 'yes' : 'no' }),
  },
  errors: {
    notMember: (who: string) => m.errors.notMember({ who }),
    higher: (who: string) => m.errors.higher({ who }),
    admin: (who: string) => m.errors.admin({ who }),
    botLower: (who: string) => m.errors.botLower({ who }),
    forbidden: (verb: string, who: string) => m.errors.forbidden({ verb, who }),
    notBanned: (who: string) => m.errors.notBanned({ who }),
    notTimedOut: (who: string) => m.errors.notTimedOut({ who }),
    noCase: (n: number) => m.errors.noCase({ n: String(n) }),
    alreadyVoid: (n: number) => m.errors.alreadyVoid({ n: String(n) }),
    noNote: (number: number) => m.errors.noNote({ number: String(number) }),
  },
  caseTitle: (n: number, title: string, voided: boolean) =>
    m.caseTitle({ n: String(n), title, voided: voided ? 'yes' : 'no' }),
  caseFooter: (userId: string | null, n: number) =>
    m.caseFooter({ userId: userId ?? '', n: String(n), hasUser: userId ? 'yes' : 'no' }),
  channelFooter: (id: string) => m.channelFooter({ id }),
  userFooter: (id: string) => m.userFooter({ id }),
  reasonHint: (prefix: string, n: number) => m.reasonHint({ prefix, n }),
  voidedLine: (by: string, when: string, reason: string | null) =>
    m.voidedLine({ by, when, reason: reason ?? '', hasReason: reason ? 'yes' : 'no' }),
  risk: {
    newAccount: (ageMs: number) => m.risk.newAccount({ age: humanDuration(ageMs) }),
    names: (n: number) => m.risk.names({ n }),
    warns: (n: number) => m.risk.warns({ n }),
    banned: (n: number) => m.risk.banned({ n }),
  },
  cases: {
    titleFor: (name: string) => m.cases.titleFor({ name }),
    emptyFor: (who: string) => m.cases.emptyFor({ who }),
    by: (who: string) => m.cases.by({ who }),
    summary: (total: number, warns: number, notes: number) =>
      m.cases.summary({ total, warns, notes }),
  },
  warnings: {
    title: (name: string) => m.warnings.title({ name }),
    empty: (who: string) => m.warnings.empty({ who }),
    expires: (when: string) => m.warnings.expires({ when }),
    cleared: (n: number, who: string) => m.warnings.cleared({ n, who }),
  },
  reason: {
    set: (n: number) => m.reason.set({ n: String(n) }),
  },
  voided: (n: number) => m.voided({ n: String(n) }),
  notes: {
    added: (who: string) => m.notes.added({ who }),
    title: (name: string) => m.notes.title({ name }),
    empty: (who: string) => m.notes.empty({ who }),
    removed: (number: number) => m.notes.removed({ number: String(number) }),
    line: (number: number, when: string, by: string) =>
      m.notes.line({ number: String(number), when, by }),
  },
  purge: {
    progress: (done: number, total: number) => m.purge.progress({ done, total }),
    done: (n: number, seconds: number | null) =>
      m.purge.done({
        n,
        seconds: seconds ?? 0,
        withTime: seconds !== null && seconds >= 3 ? 'yes' : 'no',
      }),
    badFilter: (token: string) => m.purge.badFilter({ token: code(token) }),
    confirm: (n: number, channel: string) => m.purge.confirm({ n, channel }),
    confirmHint: (icon: string) => m.purge.confirmHint({ icon }),
    summary: (n: number, channel: string) => m.purge.summary({ n, channel }),
  },
  massban: {
    tooMany: (max: number) => m.massban.tooMany({ max }),
    confirm: (n: number) => m.massban.confirm({ n }),
    reason: (reason: string) => m.massban.reason({ reason }),
    confirmHint: (icon: string) => m.massban.confirmHint({ icon }),
    progress: (done: number, total: number) => m.massban.progress({ done, total }),
    done: (banned: number, total: number) => m.massban.done({ banned, total }),
    cases: (first: number, last: number) =>
      m.massban.cases({
        first: String(first),
        last: String(last),
        range: first === last ? 'no' : 'yes',
      }),
    skipped: (n: number) => m.massban.skipped({ n }),
    failed: (n: number) => m.massban.failed({ n }),
    logSummary: (banned: number, total: number) => m.massban.logSummary({ banned, total }),
  },
  lock: {
    locked: (channel: string) => m.lock.locked({ channel }),
    lockedUntil: (channel: string, when: string) => m.lock.lockedUntil({ channel, when }),
    already: (channel: string) => m.lock.already({ channel }),
    unlocked: (channel: string) => m.lock.unlocked({ channel }),
    notLocked: (channel: string) => m.lock.notLocked({ channel }),
  },
  slowmode: {
    set: (channel: string, delay: string) => m.slowmode.set({ channel, delay }),
    off: (channel: string) => m.slowmode.off({ channel }),
  },
}));

const englishTitles: Record<CaseAction, string> = en.actions;

const english = <T>(run: () => T): T => withLanguage('en', run);

export const reasons = {
  noReason: 'No reason given',
  banExpired: 'Ban expired',
  undone: 'Undone from the audit trail',
  declined: 'Review declined',
  lockExpired: 'Lock expired',
  escalation: (active: number, days: number) => `${active} warnings in ${days} days`,
  audit: {
    case: (action: CaseAction, n: number, who: string) =>
      `${englishTitles[action]} for ${who}, case #${n}`,
    reason: (n: number) => `Changed the reason of case #${n}`,
    void: (n: number) => `Voided case #${n}`,
    clear: (n: number, who: string) => english(() => `Removed ${plural(n, 'warning')} from ${who}`),
    note: (who: string) => `Added a note on ${who}`,
    noteRemoved: (number: number) => `Removed note #${number}`,
    lock: (channel: string) => `Locked #${channel}`,
    unlock: (channel: string) => `Unlocked #${channel}`,
    slowmode: (channel: string, seconds: number) =>
      english(() =>
        seconds > 0
          ? `Set slowmode in #${channel} to ${humanDuration(seconds * 1_000)}`
          : `Turned off slowmode in #${channel}`,
      ),
    purge: (n: number, channel: string) =>
      english(() => `Deleted ${plural(n, 'message')} in #${channel}`),
  },
};
