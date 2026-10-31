import { mention } from '../../commands/mentions.js';
import { localized } from '../../i18n/localized.js';
import { bold, code, lines, subtext, timestamp } from '../../ui/format.js';
import type { TicketTarget } from './config.js';
import de from './copy.de.js';
import { padNumber } from './naming.js';

type Kind = TicketTarget['kind'];

const en = {
  commands: {
    ticket: 'Private tickets with the team.',
    open: 'Opens a private ticket with the team.',
    close: 'Closes this ticket and keeps a transcript.',
    claim: 'Takes this ticket. Again to let it go.',
    add: 'Lets a member see this ticket.',
    remove: 'Takes a member out of this ticket.',
    rename: 'Renames this ticket channel.',
    modmail: 'Sends your next DM to the team here.',
  },
  panelDescription: (kind: Kind, emoji: string) =>
    ({
      support: `Need help? React with ${emoji} to open a ticket.`,
      report: `Something wrong in here? React with ${emoji}. Only the team sees your ticket.`,
      appeal: `Want a decision looked at again? React with ${emoji} to open an appeal.`,
      custom: `React with ${emoji} to open a ticket.`,
      modmail: `React with ${emoji} to open a ticket.`,
    })[kind],
  openDefault: (kind: Kind) =>
    ({
      support: 'Tell us what you need. The team will be with you shortly.',
      report: 'Tell us what happened and who was involved. Message links help.',
      appeal: 'Tell us which decision you want reviewed and why.',
      custom: 'The team will be with you shortly.',
      modmail: 'New modmail. Messages here go to the member by DM.',
    })[kind],
  ticketTitle: (name: string, number: number) => `${name} #${padNumber(number)}`,
  ticketTopic: (name: string, number: number, openerId: string) =>
    `${name} #${padNumber(number)} for ${openerId}`,
  closeHint: (emoji: string) => `React with ${emoji} to close.`,
  internalHint: (marker: string) => `Start a message with ${code(marker)} to keep it internal.`,
  subject: (text: string) => `**Subject** ${text}`,
  opened: (channelId: string) => `Opened ${mention.channel(channelId)}.`,
  alreadyOpen: (channelId: string | null) =>
    channelId
      ? `You already have a ticket open: ${mention.channel(channelId)}.`
      : 'You already have a ticket open.',
  notSetUp: "Tickets aren't set up here yet. An admin can add a panel in the dashboard.",
  openFailed: "I couldn't create the ticket channel. Check my permissions on the category.",
  inCommunity: 'in this community',
  theCommunity: 'The community',
  communityFallback: 'the community',
  notTicket: "This isn't an open ticket.",
  teamOnly: 'Only the ticket team can do that.',
  closeNotAllowed: 'Only the ticket team can close this one.',
  closed: (by: string | null) => (by ? `Closed by ${mention.user(by)}.` : 'Closed.'),
  closedIdle: 'Closed after no activity.',
  reason: (text: string) => `**Reason** ${text}`,
  goesAway: (at: Date) => subtext(`This channel goes away ${timestamp(at, 'R')}.`),
  archived: subtext('The channel stays as an archive.'),
  claimed: (userId: string) => `${mention.user(userId)} has this one.`,
  unclaimed: 'Nobody has this one now.',
  added: (userId: string) => `${mention.user(userId)} can see this ticket now.`,
  removed: (userId: string) => `${mention.user(userId)} no longer sees this ticket.`,
  alreadyAdded: (userId: string) => `${mention.user(userId)} is already in.`,
  notAdded: (userId: string) => `${mention.user(userId)} wasn't added to this ticket.`,
  keepOpener: 'The person who opened the ticket stays.',
  notMember: "That's not a member here.",
  renamed: (name: string) => `Renamed to ${code(name)}.`,
  badName: "That name doesn't work for a channel. Use letters, numbers and dashes.",
  reopened: (by: string | null) => (by ? `Reopened by ${mention.user(by)}.` : 'Reopened.'),
  cannedUnknown: (prefix: string, names: string[]) =>
    names.length
      ? `No canned reply called that. Try ${names.map((name) => code(`${prefix}${name}`)).join(', ')}.`
      : 'No canned replies yet. Add them in the dashboard.',
  modmailSent: (guild: string) => `Sent to the ${bold(guild)} team. Replies show up here.`,
  modmailPick: (entries: { number: number; name: string }[], page: number, pages: number) =>
    lines(
      'Which community is this for? Reply with the number or part of the name.',
      ...entries.map((entry) => `${code(String(entry.number))} ${bold(entry.name)}`),
      pages > 1 && subtext(`Page ${page} of ${pages}. React with the arrows to turn the page.`),
    ),
  modmailNoMatch: (query: string) =>
    `No community in the list matches ${bold(query)}. Reply with a number or another part of the name.`,
  modmailExpired: 'That list ran out after 5 minutes. Here is a fresh one.',
  modmailGone: (guild: string) => `${bold(guild)} can't take your message right now. Pick another.`,
  modmailTryLater: "I couldn't check your communities just now. Try again in a minute.",
  modmailReady: (guild: string) => `Write me here and it goes to the ${bold(guild)} team.`,
  modmailCheckDms: 'Check your DMs.',
  modmailDmsClosed: "I can't DM you. Allow DMs from this community and try again.",
  modmailOff: 'Modmail is off in this community.',
  modmailOpenHere: 'You already have modmail open here. Just write me in DMs.',
  modmailClosed: (guild: string) => `The ${bold(guild)} team closed this conversation.`,
  modmailUnreachable: "I couldn't reach them. Their DMs are closed.",
  modmailUnavailable: (guild: string) => `${bold(guild)} can't take messages right now.`,
  modmailTeam: (guild: string) => `${guild} team`,
  modmailFrom: (guild: string) => `From ${guild}`,
  ratingPrompt: (number: number, guild: string, reactions: boolean) =>
    lines(
      `Your ticket #${padNumber(number)} in ${bold(guild)} is closed.`,
      reactions
        ? 'How did it go? React with 1 to 5.'
        : 'How did it go? Reply with a number from 1 to 5.',
    ),
  ratingThanks: (rating: number) => `Thanks. Noted ${rating} of 5.`,
  ratingLog: (number: number, rating: number, userId: string) =>
    `Ticket #${padNumber(number)} got **${rating} of 5** from ${mention.user(userId)}.`,
  logOpened: 'Ticket opened',
  logClosed: 'Ticket closed',
  logOpener: (userId: string) => `**Opened by** ${mention.user(userId)}`,
  logClaimed: (userId: string) => `**Claimed by** ${mention.user(userId)}`,
  logClosedBy: (userId: string | null) =>
    userId ? `**Closed by** ${mention.user(userId)}` : '**Closed by** Maxwell',
  logMessages: (count: string) => `**Messages** ${count}`,
  logDuration: (text: string) => `**Open for** ${text}`,
  logTranscript: (url: string) => `[Transcript](${url})`,
  logChannel: (channelId: string) => `**Channel** ${mention.channel(channelId)}`,
  footerTicket: (number: number, userId: string) => `Ticket ${number} / User ${userId}`,
  footerUser: (userId: string) => `User ${userId}`,
  fromWeb: 'Sent from the web form.',
};

export type TicketsCopy = typeof en;

export const ticketsCopy = localized(en, { de });

export const ticketsAudit = {
  reason: 'Maxwell tickets',
  auditClose: (number: number) => `Closed ticket #${padNumber(number)}`,
  auditReopen: (number: number) => `Reopened ticket #${padNumber(number)}`,
  auditClaim: (number: number) => `Claimed ticket #${padNumber(number)}`,
  auditUnclaim: (number: number) => `Unclaimed ticket #${padNumber(number)}`,
  auditAdd: (number: number) => `Added a member to ticket #${padNumber(number)}`,
  auditRemove: (number: number) => `Removed a member from ticket #${padNumber(number)}`,
  auditRename: (number: number, name: string) => `Renamed ticket #${padNumber(number)} to ${name}`,
  auditPublish: (name: string) => `Posted the ${name} ticket panel`,
  auditUnpublish: (name: string) => `Removed the ${name} ticket panel`,
};
