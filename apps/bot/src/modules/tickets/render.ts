import type { Ticket, TicketEmbed } from '@maxwell/core/stores/tickets';
import { formatDuration } from '../../commands/duration.js';
import type { Attachment, Embed, UserRef } from '../../platform/types.js';
import { count, lines, truncate } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { ticketsCopy as copy } from './copy.js';

export function transcriptUrl(base: string | undefined, guildId: string, ticketId: string) {
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/guilds/${guildId}/tickets/${ticketId}`;
}

const EMBED_LIMIT = 10;
const FIELD_LIMIT = 25;

export function transcriptEmbeds(embeds: readonly Embed[] | undefined): TicketEmbed[] {
  const out: TicketEmbed[] = [];
  for (const embed of (embeds ?? []).slice(0, EMBED_LIMIT)) {
    const entry: TicketEmbed = {};
    if (embed.title) entry.title = truncate(embed.title, 256);
    if (embed.url) entry.url = embed.url;
    if (embed.description) entry.description = truncate(embed.description, 4096);
    if (typeof embed.color === 'number') entry.color = embed.color;
    if (embed.author?.name) entry.author = truncate(embed.author.name, 256);
    if (embed.fields?.length) {
      entry.fields = embed.fields.slice(0, FIELD_LIMIT).map((field) => ({
        name: truncate(field.name, 256),
        value: truncate(field.value, 1024),
      }));
    }
    if (embed.footer) entry.footer = truncate(embed.footer, 2048);
    if (embed.imageUrl) entry.imageUrl = embed.imageUrl;
    if (embed.thumbnailUrl) entry.thumbnailUrl = embed.thumbnailUrl;
    if (embed.timestamp instanceof Date && !Number.isNaN(embed.timestamp.getTime())) {
      entry.timestamp = embed.timestamp.toISOString();
    }
    if (Object.keys(entry).length > 0) out.push(entry);
  }
  return out;
}

export function attachmentLines(attachments: readonly Attachment[]): string[] {
  return attachments.map((file) => `[${file.filename}](${file.url})`);
}

export function bodyWithAttachments(content: string, attachments: readonly Attachment[]): string {
  return truncate(lines(content.trim() || null, ...attachmentLines(attachments)), 4000);
}

export function openLogEmbed(ticket: Ticket, panelName: string): Embed {
  return {
    color: palette.north,
    title: copy.logOpened,
    description: lines(
      copy.ticketTitle(panelName, ticket.number),
      copy.logOpener(ticket.openerId),
      ticket.channelId && copy.logChannel(ticket.channelId),
      ticket.subject && copy.subject(truncate(ticket.subject, 200)),
    ),
    footer: copy.footerTicket(ticket.number, ticket.openerId),
    timestamp: ticket.createdAt,
  };
}

export function closeLogEmbed(
  ticket: Ticket,
  panelName: string,
  messages: number,
  url: string | null,
): Embed {
  const closedAt = ticket.closedAt ?? new Date();
  return {
    color: palette.muted,
    title: copy.logClosed,
    description: lines(
      copy.ticketTitle(panelName, ticket.number),
      copy.logOpener(ticket.openerId),
      ticket.claimedBy && copy.logClaimed(ticket.claimedBy),
      copy.logClosedBy(ticket.closedBy),
      ticket.closeReason && copy.reason(truncate(ticket.closeReason, 500)),
      copy.logMessages(count(messages)),
      copy.logDuration(formatDuration(closedAt.getTime() - ticket.createdAt.getTime())),
      url && copy.logTranscript(url),
    ),
    footer: copy.footerTicket(ticket.number, ticket.openerId),
    timestamp: closedAt,
  };
}

export function memberRelayEmbed(
  user: UserRef,
  content: string,
  attachments: readonly Attachment[],
  at: Date,
): Embed {
  return {
    color: palette.south,
    author: { name: `${user.displayName} (@${user.username})`, iconUrl: user.avatarUrl },
    description: bodyWithAttachments(content, attachments) || undefined,
    footer: copy.footerUser(user.id),
    timestamp: at,
  };
}

export function staffReplyEmbed(author: UserRef | null, content: string): Embed {
  return {
    color: palette.north,
    author: author ? { name: author.displayName, iconUrl: author.avatarUrl } : undefined,
    description: truncate(content, 4000),
  };
}

export function teamRelayEmbed(
  guild: { name: string; iconUrl: string | null },
  author: UserRef | null,
  content: string,
  attachments: readonly Attachment[],
): Embed {
  return {
    color: palette.north,
    author: author
      ? { name: author.displayName, iconUrl: author.avatarUrl }
      : { name: copy.modmailTeam(guild.name), iconUrl: guild.iconUrl ?? undefined },
    description: bodyWithAttachments(content, attachments) || undefined,
    footer: copy.modmailFrom(guild.name),
  };
}
