import { mention } from '../../commands/mentions.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/tickets.json' with { type: 'json' };
import { bold, code, escapeMarkdown, lines, subtext, timestamp } from '../../ui/format.js';
import type { TicketTarget } from './config.js';
import { padNumber } from './naming.js';

type Kind = TicketTarget['kind'];

export const ticketsCopy = catalog('tickets', en, (m) => ({
  panelDescription: (kind: Kind, emoji: string) => m.panelDescription({ kind, emoji }),
  openDefault: (kind: Kind) => m.openDefault({ kind }),
  ticketTitle: (name: string, number: number) => m.ticketTitle({ name, number: padNumber(number) }),
  ticketTopic: (name: string, number: number, openerId: string) =>
    m.ticketTopic({ name, number: padNumber(number), userId: openerId }),
  closeHint: (emoji: string) => m.closeHint({ emoji }),
  internalHint: (marker: string) => m.internalHint({ marker: code(marker) }),
  subject: (text: string) => m.subject({ text }),
  opened: (channelId: string) => m.opened({ channel: mention.channel(channelId) }),
  alreadyOpen: (channelId: string | null) =>
    m.alreadyOpen({
      state: channelId ? 'channel' : 'none',
      channel: channelId ? mention.channel(channelId) : '',
    }),
  closed: (by: string | null) =>
    m.closed({ source: by ? 'member' : 'none', user: by ? mention.user(by) : '' }),
  reason: (text: string) => m.reason({ text }),
  goesAway: (at: Date) => subtext(m.goesAway({ when: timestamp(at, 'R') })),
  claimed: (userId: string) => m.claimed({ user: mention.user(userId) }),
  added: (userId: string) => m.added({ user: mention.user(userId) }),
  removed: (userId: string) => m.removed({ user: mention.user(userId) }),
  alreadyAdded: (userId: string) => m.alreadyAdded({ user: mention.user(userId) }),
  notAdded: (userId: string) => m.notAdded({ user: mention.user(userId) }),
  renamed: (name: string) => m.renamed({ name: code(name) }),
  reopened: (by: string | null) =>
    m.reopened({ source: by ? 'member' : 'none', user: by ? mention.user(by) : '' }),
  cannedUnknown: (prefix: string, names: string[]) =>
    m.cannedUnknown({
      known: names.length ? 'yes' : 'no',
      names: names.map((name) => code(`${prefix}${name}`)).join(', '),
    }),
  modmailSent: (guild: string) => m.modmailSent({ guild: escapeMarkdown(guild) }),
  modmailPick: (entries: { number: number; name: string }[], page: number, pages: number) =>
    lines(
      m.modmailPick(),
      ...entries.map((entry) => `${code(String(entry.number))} ${bold(entry.name)}`),
      pages > 1 && subtext(m.modmailPage({ page, pages })),
    ),
  modmailNoMatch: (query: string) => m.modmailNoMatch({ query: escapeMarkdown(query) }),
  modmailGone: (guild: string) => m.modmailGone({ guild: escapeMarkdown(guild) }),
  modmailReady: (guild: string) => m.modmailReady({ guild: escapeMarkdown(guild) }),
  modmailClosed: (guild: string) => m.modmailClosed({ guild: escapeMarkdown(guild) }),
  modmailUnavailable: (guild: string) => m.modmailUnavailable({ guild: escapeMarkdown(guild) }),
  modmailTeam: (guild: string) => m.modmailTeam({ guild }),
  modmailFrom: (guild: string) => m.modmailFrom({ guild }),
  ratingPrompt: (number: number, guild: string, reactions: boolean) =>
    m.ratingPrompt({
      number: padNumber(number),
      guild: escapeMarkdown(guild),
      reactions: reactions ? 'yes' : 'no',
    }),
  ratingThanks: (rating: number) => m.ratingThanks({ rating: String(rating) }),
  ratingLog: (number: number, rating: number, userId: string) =>
    m.ratingLog({ number: padNumber(number), rating, user: mention.user(userId) }),
  logOpener: (userId: string) => m.logOpener({ user: mention.user(userId) }),
  logClaimed: (userId: string) => m.logClaimed({ user: mention.user(userId) }),
  logClosedBy: (userId: string | null) =>
    m.logClosedBy({ source: userId ? 'member' : 'none', user: userId ? mention.user(userId) : '' }),
  logMessages: (count: string) => m.logMessages({ count }),
  logDuration: (text: string) => m.logDuration({ text }),
  logTranscript: (url: string) => m.logTranscript({ url }),
  logChannel: (channelId: string) => m.logChannel({ channel: mention.channel(channelId) }),
  footerTicket: (number: number, userId: string) =>
    m.footerTicket({ number: String(number), userId }),
  footerUser: (userId: string) => m.footerUser({ userId }),
}));

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
