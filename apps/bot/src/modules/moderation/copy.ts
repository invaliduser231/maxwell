import {
  type CaseAction,
  defaultDmTemplate,
  type EscalationAction,
} from '@maxwell/core/modules/moderation';
import { withLanguage } from '../../i18n/language.js';
import { localized } from '../../i18n/localized.js';
import { code, count, ordinal, plural } from '../../ui/format.js';
import de from './copy.de.js';
import es from './copy.es.js';
import { humanDuration } from './text.js';

const escalationNouns: Record<EscalationAction, string> = {
  timeout: 'timeout',
  kick: 'kick',
  ban: 'ban',
};

const en = {
  commands: {
    ban: 'Bans a member, for good or for a while.',
    unban: 'Lifts a ban.',
    kick: 'Removes a member. They can come back with an invite.',
    timeout: 'Mutes a member for a while. They can read but not write.',
    untimeout: 'Ends a timeout early.',
    warn: 'Warns a member. Warnings add up on the escalation ladder.',
    caseVoid: 'Marks a case as void. It stops counting towards escalation.',
    case: 'Shows one case.',
    cases: 'Lists recent cases, or the record of one member.',
    reason: 'Sets or changes the reason of a case.',
    warningsClear: 'Voids all active warnings of a member.',
    warnings: 'Lists the active warnings of a member.',
    lock: 'Stops members from writing in a channel. Moderators can still talk.',
    unlock: 'Opens a locked channel again.',
    slowmode: 'Sets how long members wait between messages in a channel.',
    purge: 'Deletes recent messages in this channel, optionally filtered.',
    massban: 'Bans several members at once by ID or mention.',
    noteRemove: 'Removes a note.',
    note: 'Adds a private note to a member file. Only moderators see notes.',
    notes: 'Sends you the notes on a member as a DM.',
  },

  actions: {
    ban: 'Ban',
    unban: 'Unban',
    kick: 'Kick',
    timeout: 'Timeout',
    untimeout: 'Timeout lifted',
    warn: 'Warning',
    flag: 'Review',
  } as Record<CaseAction, string>,

  noReason: 'No reason given',
  maxwell: 'Maxwell',
  unknown: 'Unknown',
  permanent: 'Permanent',
  dmTemplate: defaultDmTemplate,

  done: {
    ban: (who: string, n: number, duration: string | null) =>
      duration ? `${who} is banned for ${duration}. Case #${n}.` : `${who} was banned. Case #${n}.`,
    unban: (who: string, n: number) => `${who} was unbanned. Case #${n}.`,
    kick: (who: string, n: number) => `${who} was kicked. Case #${n}.`,
    timeout: (who: string, n: number, duration: string) =>
      `${who} is timed out for ${duration}. Case #${n}.`,
    untimeout: (who: string, n: number) => `${who} can talk again. Case #${n}.`,
    warn: (who: string, n: number, active: number) =>
      `${who} was warned (${ordinal(active)} warning). Case #${n}.`,
  },

  addReason: (prefix: string, n: number) =>
    `No reason given. Add one with ${prefix}reason ${n} <text>.`,
  dmFailed: "They don't accept DMs, so they weren't told.",

  escalated: (
    active: number,
    days: number,
    who: string,
    action: EscalationAction,
    duration: string | null,
    n: number,
  ) => {
    const lead = `That's ${active} warnings in ${days} days, so ${who}`;
    if (action === 'timeout') return `${lead} is timed out for ${duration}. Case #${n}.`;
    if (action === 'kick') return `${lead} was kicked. Case #${n}.`;
    return duration
      ? `${lead} is banned for ${duration}. Case #${n}.`
      : `${lead} was banned. Case #${n}.`;
  },
  escalatedReview: (active: number, days: number, action: EscalationAction, n: number) =>
    `That's ${active} warnings in ${days} days. A ${escalationNouns[action]} is waiting for review in the mod log. Case #${n}.`,
  escalationFailed: (who: string) =>
    `I couldn't escalate against ${who}. Check my role and permissions.`,
  reviewSuggestion: (action: EscalationAction, duration: string | null) =>
    duration
      ? `Suggested: ${escalationNouns[action]} for ${duration}.`
      : `Suggested: ${escalationNouns[action]}.`,
  reviewApproved: (by: string) => `Approved by ${by}.`,
  reviewDeclined: (by: string) => `Declined by ${by}.`,

  dmAction: {
    warn: () => 'warned',
    timeout: (duration: string) => `timed out for ${duration}`,
    kick: () => 'kicked',
    ban: (duration: string | null) => (duration ? `banned for ${duration}` : 'banned'),
  },

  errors: {
    reasonRequired: 'A reason is required here.',
    self: "You can't do that to yourself.",
    me: 'Not on me.',
    notMember: (who: string) => `${who} isn't in this community.`,
    higher: (who: string) => `${who} has a role at or above yours.`,
    admin: (who: string) => `${who} is an admin.`,
    botLower: (who: string) => `I can't act on ${who}. My highest role has to sit above theirs.`,
    forbidden: (verb: string, who: string) =>
      `Fluxer didn't let me ${verb} ${who}. Check my role and permissions.`,
    notBanned: (who: string) => `${who} isn't banned.`,
    notTimedOut: (who: string) => `${who} isn't timed out.`,
    timeoutRange: 'Timeouts can last up to 365 days.',
    banRange: 'Timed bans can last from 1 minute to 2 years.',
    noCase: (n: number) => `There's no case #${n}.`,
    alreadyVoid: (n: number) => `Case #${n} is already void.`,
    noNote: (number: number) => `There's no note #${number}.`,
    noChannel: "That's not a channel I can see.",
  },

  verbs: {
    ban: 'ban',
    unban: 'unban',
    kick: 'kick',
    timeout: 'time out',
    untimeout: 'lift the timeout of',
  } as Record<string, string>,

  fields: {
    member: 'Member',
    moderator: 'Moderator',
    duration: 'Duration',
    reason: 'Reason',
    evidence: 'Evidence',
    excerpt: 'Message',
    editedBy: 'Edited by',
    voided: 'Voided',
    channel: 'Channel',
    ended: 'Ended',
  },
  caseTitle: (n: number, title: string, voided: boolean) =>
    `Case ${n}: ${title}${voided ? ' (void)' : ''}`,
  caseFooter: (userId: string | null, n: number) =>
    userId ? `User ${userId} / Case ${n}` : `Case ${n}`,
  channelFooter: (id: string) => `Channel ${id}`,
  userFooter: (id: string) => `User ${id}`,
  reasonHint: (prefix: string, n: number) =>
    `No reason given. ${code(`${prefix}reason ${n} <text>`)} adds one.`,
  voidedLine: (by: string, when: string, reason: string | null) =>
    reason ? `By ${by} ${when}. ${reason}` : `By ${by} ${when}.`,

  risk: {
    newAccount: (ageMs: number) => `Account is ${humanDuration(ageMs)} old.`,
    recentJoin: 'Joined in the last 24 hours.',
    names: (n: number) => `Changed names ${count(n)} times.`,
    warns: (n: number) => `${plural(n, 'active warning')}.`,
    banned: (n: number) =>
      n === 1 ? 'Banned here before.' : `Banned here ${count(n)} times before.`,
  },

  cases: {
    title: 'Cases',
    titleFor: (name: string) => `Cases for ${name}`,
    empty: ['No cases yet. Quiet so far.', 'No cases on record.', 'Nothing on record yet.'],
    emptyFor: (who: string) => `No cases for ${who}. Clean record.`,
    by: (who: string) => `by ${who}`,
    summary: (total: number, warns: number, notes: number) =>
      `${plural(total, 'case')}, ${plural(warns, 'active warning')}, ${plural(notes, 'note')}`,
    names: 'Earlier names',
  },

  warnings: {
    title: (name: string) => `Warnings for ${name}`,
    empty: (who: string) => `No active warnings for ${who}. Clean record.`,
    expires: (when: string) => `expires ${when}`,
    cleared: (n: number, who: string) => `Removed ${plural(n, 'warning')} from ${who}.`,
    undoHint: 'Changed your mind? Undo it in the audit trail.',
  },

  reason: {
    set: (n: number) => `Case #${n} has a new reason.`,
  },
  voided: (n: number) => `Case #${n} is void.`,

  notes: {
    added: (who: string) => `Note added for ${who}.`,
    title: (name: string) => `Notes on ${name}`,
    empty: (who: string) => `No notes on ${who}.`,
    sent: 'Sent to your DMs.',
    removed: (number: number) => `Note #${number} removed.`,
    line: (number: number, when: string, by: string) => `**#${number}** ${when} ${by}`,
  },

  purge: {
    working: 'Working on it.',
    progress: (done: number, total: number) => `Deleted ${count(done)} of ${count(total)}.`,
    done: (n: number, seconds: number | null) =>
      seconds !== null && seconds >= 3
        ? `Deleted ${plural(n, 'message')} in ${plural(seconds, 'second')}.`
        : `Deleted ${plural(n, 'message')}.`,
    nothing: 'Nothing matched, so nothing was deleted.',
    badFilter: (token: string) =>
      `I don't know the filter ${code(token)}. Use a member, ${code('bots')}, ${code('links')} or ${code('contains <text>')}.`,
    confirm: (n: number, channel: string) =>
      `> [!WARNING]\n> This deletes up to **${count(n)}** messages in ${channel}.`,
    confirmHint: (icon: string) => `React with ${icon} within 30 seconds to go ahead.`,
    expired: 'No answer, so nothing happened.',
    summary: (n: number, channel: string) => `Deleted ${plural(n, 'message')} in ${channel}`,
  },

  massban: {
    none: 'Name at least one member by ID or mention.',
    tooMany: (max: number) => `That's more than ${count(max)} members. Split the list.`,
    confirm: (n: number) => `> [!WARNING]\n> This bans **${plural(n, 'member')}**.`,
    reason: (reason: string) => `Reason: ${reason}`,
    confirmHint: (icon: string) => `React with ${icon} within 30 seconds to go ahead.`,
    expired: 'No answer, so nobody was banned.',
    progress: (done: number, total: number) => `Checked ${count(done)} of ${count(total)}.`,
    done: (banned: number, total: number) =>
      `Banned ${count(banned)} of ${plural(total, 'member')}.`,
    cases: (first: number, last: number) =>
      first === last ? `Case #${first}.` : `Cases #${first} to #${last}.`,
    skipped: (n: number) =>
      `Skipped ${count(n)}: already banned, ranked too high or out of my reach.`,
    failed: (n: number) => `${count(n)} failed. Check my role and permissions.`,
    casesField: 'Cases',
    logTitle: 'Mass ban',
    logSummary: (banned: number, total: number) =>
      `Banned ${count(banned)} of ${plural(total, 'member')}.`,
  },

  lock: {
    locked: (channel: string) => `${channel} is locked.`,
    lockedUntil: (channel: string, when: string) => `${channel} is locked until ${when}.`,
    already: (channel: string) => `${channel} is already locked.`,
    unlocked: (channel: string) => `${channel} is open again.`,
    notLocked: (channel: string) => `${channel} isn't locked.`,
  },

  slowmode: {
    set: (channel: string, delay: string) => `Slowmode in ${channel} is ${delay} now.`,
    off: (channel: string) => `Slowmode in ${channel} is off.`,
    range: 'Slowmode can be up to 6 hours.',
    bad: `That's not a delay I know. Try ${code('10s')}, ${code('1m')} or ${code('off')}.`,
  },

  logTitles: {
    lock: 'Channel locked',
    unlock: 'Channel unlocked',
    slowmode: 'Slowmode changed',
    purge: 'Messages purged',
  },
};

export type ModerationCopy = typeof en;

export const copy = localized(en, { de, es });

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
