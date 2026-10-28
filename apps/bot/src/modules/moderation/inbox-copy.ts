import type { InboxKind } from '@maxwell/core/modules/moderation';
import { localized } from '../../i18n/localized.js';
import { count, plural } from '../../ui/format.js';
import de from './inbox-copy.de.js';

const en = {
  command:
    'Sends a message or a member to the moderators. Reply to the message, or name the member.',
  sent: 'Sent to the moderators.',
  already: 'You already reported that.',
  nothing: 'Reply to the message you want to report, or name the member.',
  self: "You can't report yourself.",
  bot: 'Bots are not reported, ask a moderator.',
  off: 'Reports are turned off here.',
  reactionSent: (server: string) => `Your report in **${server}** went to the moderators.`,
  titles: {
    report: (n: number) => `Report #${n}`,
    appeal: (n: number) => `Appeal #${n}`,
    review: (n: number) => `Review #${n}`,
  } satisfies Record<InboxKind, (n: number) => string>,
  fields: {
    member: 'Member',
    reporters: 'Reported by',
    message: 'Message',
    report: 'Report',
    appeal: 'Appeal',
    review: 'Reason',
    status: 'Status',
    outcome: 'Outcome',
    note: 'Note',
  },
  reporters: (n: number) => plural(n, 'member'),
  jump: 'Jump to message',
  gone: 'Deleted',
  dashboard: 'Open in the dashboard',
  status: {
    open: 'Open',
    claimed: (who: string) => `Claimed by ${who}`,
    resolved: (who: string) => `Resolved by ${who}`,
    dismissed: (who: string) => `Dismissed by ${who}`,
  },
  outcomes: {
    warn: (n: number) => `Warned, case #${n}`,
    timeout: (n: number) => `Timed out, case #${n}`,
    kick: (n: number) => `Kicked, case #${n}`,
    ban: (n: number) => `Banned, case #${n}`,
    unban: (n: number) => `Unbanned, case #${n}`,
    approved: 'Approved',
    declined: 'Declined',
    deleted: 'Message deleted',
    none: 'No action',
  },
  appealAccepted: (server: string) =>
    `Your appeal in **${server}** was accepted. You can join again with an invite.`,
  appealDeclined: (server: string) => `Your appeal in **${server}** was declined.`,
  more: (n: number) => `and ${count(n)} more`,
};

export type InboxCopy = typeof en;

export const inboxCopy = localized(en, { de });

const kinds: Record<InboxKind, string> = { report: 'report', appeal: 'appeal', review: 'review' };

export const inboxAudit = {
  claim: (kind: InboxKind, n: number) => `Claimed ${kinds[kind]} #${n}`,
  release: (kind: InboxKind, n: number) => `Released ${kinds[kind]} #${n}`,
  resolve: (kind: InboxKind, n: number) => `Resolved ${kinds[kind]} #${n}`,
  dismiss: (kind: InboxKind, n: number) => `Dismissed ${kinds[kind]} #${n}`,
};
