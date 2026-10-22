import type { Ticket } from '@maxwell/core/stores/tickets';
import { inGuild } from '../../i18n/language.js';
import type { IncomingMessage, ReactionEvent } from '../../platform/types.js';
import { ticketsCopy as copy } from './copy.js';
import { ratingEmojis, ratingFromEmoji, ratingFromText } from './emoji.js';
import type { TicketService } from './service.js';

export class Ratings {
  constructor(private readonly service: TicketService) {}

  async request(ticket: Ticket, guildName: string): Promise<void> {
    const { platform } = this.service.services;
    const { store } = this.service;
    const user = await platform.user(ticket.openerId);
    if (!user || user.bot) return;

    const channelId = await this.service.dmChannel(ticket.openerId);
    if (channelId) {
      try {
        const messageId = await platform.send(
          channelId,
          copy.ratingPrompt(ticket.number, guildName, true),
        );
        for (const emoji of ratingEmojis) {
          await platform.react(channelId, messageId, emoji).catch(() => {});
        }
        await store.requestRating(ticket.id, { channelId, messageId });
        return;
      } catch {}
    }

    const sent = await platform.sendDirect(
      ticket.openerId,
      copy.ratingPrompt(ticket.number, guildName, false),
    );
    if (sent) await store.requestRating(ticket.id, null);
  }

  async onReaction(reaction: ReactionEvent): Promise<void> {
    if (reaction.guildId || reaction.bot) return;
    const rating = ratingFromEmoji(reaction.emoji);
    if (rating === null) return;
    const ticket = await this.service.store.ratingByMessage(reaction.messageId);
    if (!ticket || ticket.openerId !== reaction.userId) return;
    await inGuild(ticket.guildId, async () => {
      if (!(await this.#apply(ticket, rating))) return;
      await this.service.services.platform
        .edit(reaction.channelId, reaction.messageId, copy.ratingThanks(rating))
        .catch(() => {});
    });
  }

  async onText(message: IncomingMessage): Promise<boolean> {
    const rating = ratingFromText(message.content);
    if (rating === null) return false;
    const ticket = await this.service.store.pendingRating(message.author.id);
    if (!ticket) return false;
    return inGuild(ticket.guildId, async () => {
      if (!(await this.#apply(ticket, rating))) return false;
      await this.service.services.platform
        .reply(message, copy.ratingThanks(rating))
        .catch(() => {});
      return true;
    });
  }

  async #apply(ticket: Ticket, rating: number): Promise<boolean> {
    if (!(await this.service.store.rate(ticket.id, rating))) return false;
    if (await this.service.ctx.enabled(ticket.guildId)) {
      await this.service.log(
        ticket.guildId,
        copy.ratingLog(ticket.number, rating, ticket.openerId),
      );
    }
    return true;
  }
}
