import type { TicketMessage } from '@maxwell/core/stores/tickets';
import type { PrivacyHandler } from '../../runtime/privacy.js';
import type { TicketService } from './service.js';

function exportMessage(message: TicketMessage, userId: string) {
  return {
    author: message.authorName,
    mine: message.authorId === userId,
    bot: message.bot,
    via: message.via,
    content: message.content,
    attachments: message.attachments,
    embeds: message.embeds,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
  };
}

export function isInternalNote(
  message: TicketMessage,
  source: string,
  openerId: string,
  marker: string,
): boolean {
  return (
    source === 'modmail' &&
    !message.bot &&
    message.authorId !== openerId &&
    message.via === null &&
    message.content.startsWith(marker)
  );
}

export function ticketPrivacy(service: TicketService): PrivacyHandler {
  const { store } = service;
  return {
    async export(guildId, userId) {
      const config = await service.ctx.config(guildId);
      const marker = config.modmail.internalMarker;
      const opened = await store.openedBy(guildId, userId);
      const transcripts = await store.transcripts(opened.map((ticket) => ticket.id));
      const written = await store.writtenElsewhere(guildId, userId);
      const dmChannelId = await store.dmChannel(userId);
      if (opened.length === 0 && written.length === 0 && !dmChannelId) return null;
      return {
        tickets: opened.map((ticket) => ({
          number: ticket.number,
          panel: ticket.panelId,
          kind: ticket.kind,
          source: ticket.source,
          status: ticket.status,
          subject: ticket.subject,
          createdAt: ticket.createdAt,
          closedAt: ticket.closedAt,
          closeReason: ticket.closeReason,
          rating: ticket.rating,
          ratedAt: ticket.ratedAt,
          transcript: (transcripts.get(ticket.id) ?? [])
            .filter((message) => !isInternalNote(message, ticket.source, userId, marker))
            .map((message) => exportMessage(message, userId)),
        })),
        messagesInOtherTickets: written.map((message) => ({
          ticket: message.ticketNumber,
          ...exportMessage(message, userId),
        })),
        dmChannelId,
      };
    },
    async forget(guildId, userId) {
      await store.forgetMember(guildId, userId);
      await store.forgetDm(userId);
      await store.forgetModmailTargets(userId, guildId);
      service.forgetCached();
    },
  };
}
