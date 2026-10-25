import 'server-only';
import { ticketsConfig } from '@maxwell/core/modules/tickets';
import {
  type Ticket,
  type TicketEmbed,
  type TicketMessage,
  TicketStore,
} from '@maxwell/core/stores/tickets';
import { db } from '@/lib/db';
import { mentionedIds, type Names, namesOf } from '@/lib/people';

export const CLOSED_PAGE = 8;

export interface TicketView {
  id: string;
  number: number;
  subject: string | null;
  source: string;
  panelId: string;
  status: 'open' | 'closed';
  openerId: string;
  claimedBy: string | null;
  members: string[];
  channelId: string | null;
  createdAt: string;
  lastMessageAt: string;
  firstResponseAt: string | null;
  closedAt: string | null;
  closedBy: string | null;
  closeReason: string | null;
  rating: number | null;
  messageCount: number;
}

export interface MessageView {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  bot: boolean;
  via: string | null;
  content: string;
  attachments: { filename: string; url: string }[];
  embeds: TicketEmbed[];
  createdAt: string;
  edited: boolean;
  deleted: boolean;
  internal: boolean;
}

export interface Detail {
  ticket: TicketView;
  messages: MessageView[];
  total: number;
  names: Names;
}

export function ticketView(row: Ticket): TicketView {
  return {
    id: row.id,
    number: row.number,
    subject: row.subject,
    source: row.source,
    panelId: row.panelId,
    status: row.status,
    openerId: row.openerId,
    claimedBy: row.claimedBy,
    members: row.members,
    channelId: row.channelId,
    createdAt: row.createdAt.toISOString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
    firstResponseAt: row.firstResponseAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    closedBy: row.closedBy,
    closeReason: row.closeReason,
    rating: row.rating,
    messageCount: row.messageCount,
  };
}

export function messageViews(
  ticket: Ticket,
  rows: readonly TicketMessage[],
  marker: string,
): MessageView[] {
  return rows.map((row) => ({
    id: row.messageId,
    authorId: row.authorId,
    authorName: row.authorName,
    authorAvatar: row.authorAvatar,
    bot: row.bot,
    via: row.via,
    content: row.content,
    attachments: row.attachments.map((file) => ({ filename: file.filename, url: file.url })),
    embeds: row.embeds,
    createdAt: row.createdAt.toISOString(),
    edited: row.editedAt !== null,
    deleted: row.deletedAt !== null,
    internal:
      ticket.source === 'modmail' &&
      !row.bot &&
      row.authorId !== ticket.openerId &&
      row.via === null &&
      row.content.startsWith(marker),
  }));
}

export function textIds(messages: readonly MessageView[]): string[] {
  return messages.flatMap((message) => [
    ...mentionedIds(message.content),
    ...message.embeds.flatMap((embed) => mentionedIds(embed.description ?? '')),
  ]);
}

export async function loadDetail(
  guildId: string,
  ticketId: string,
  limit = 40,
): Promise<Detail | null> {
  const store = new TicketStore(db().sql);
  const ticket = await store.getInGuild(guildId, ticketId);
  if (!ticket) return null;
  const [rows, total, config] = await Promise.all([
    store.lastMessages(ticket.id, limit),
    store.transcriptSize(ticket.id),
    db().modules.get(guildId, 'tickets', ticketsConfig),
  ]);
  const messages = messageViews(ticket, rows, config.modmail.internalMarker);
  const names = await namesOf([
    ticket.openerId,
    ticket.claimedBy,
    ...ticket.members,
    ...textIds(messages),
  ]);
  return { ticket: ticketView(ticket), messages, total, names };
}

export async function loadClosed(
  guildId: string,
  offset: number,
): Promise<{ items: TicketView[]; names: Names; more: boolean }> {
  const store = new TicketStore(db().sql);
  const rows = await store.recentlyClosed(guildId, { limit: CLOSED_PAGE + 1, offset });
  const items = rows.slice(0, CLOSED_PAGE).map(ticketView);
  const names = await namesOf(items.flatMap((item) => [item.openerId, item.closedBy]));
  return { items, names, more: rows.length > CLOSED_PAGE };
}
