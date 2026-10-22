import type { Actor } from '@maxwell/core';
import type { PublishedPanel } from '@maxwell/core/stores/tickets';
import { mention } from '../../commands/mentions.js';
import type { Embed, ReactionEvent } from '../../platform/types.js';
import { palette } from '../../ui/palette.js';
import { BoundedCache } from './cache.js';
import { panelTarget, type TicketPanel } from './config.js';
import { ticketsCopy as copy, ticketsAudit } from './copy.js';
import { displayEmoji, fallbackEmoji, normalizeEmoji, sameEmoji } from './emoji.js';
import { fillTemplate } from './naming.js';
import type { TicketService } from './service.js';

export type PublishOutcome = 'posted' | 'updated' | 'missing' | 'no-channel' | 'permissions';

export function panelEmoji(panel: TicketPanel): string {
  return normalizeEmoji(panel.emoji) || fallbackEmoji.open;
}

export function panelEmbed(panel: TicketPanel): Embed {
  const emoji = displayEmoji(panelEmoji(panel));
  return {
    color: palette.north,
    title: panel.title || panel.name,
    description: panel.description
      ? fillTemplate(panel.description, { emoji })
      : copy.panelDescription(panel.kind, emoji),
  };
}

export class Panels {
  readonly #byMessage = new BoundedCache<string, PublishedPanel | null>(5_000, 10 * 60_000);
  readonly #warned = new BoundedCache<string, true>(1_000, 10 * 60_000);

  constructor(private readonly service: TicketService) {}

  async publish(guildId: string, panelId: string, actor: Actor): Promise<PublishOutcome> {
    const { platform, log } = this.service.services;
    const { ctx, store } = this.service;
    const config = await ctx.config(guildId);
    const panel = config.panels.find((candidate) => candidate.id === panelId);
    if (!panel) return 'missing';
    const channelId = panel.channelId;
    if (!channelId || !(await platform.channelInGuild(guildId, channelId).catch(() => false))) {
      return 'no-channel';
    }
    const missing = await platform
      .missingBotPermissions(guildId, channelId, ['SendMessages', 'EmbedLinks', 'AddReactions'])
      .catch(() => ['SendMessages']);
    if (missing.length) return 'permissions';

    const emoji = panelEmoji(panel);
    const embed = panelEmbed(panel);
    const previous = await store.panel(guildId, panelId);

    if (previous && previous.channelId === channelId) {
      try {
        await platform.edit(channelId, previous.messageId, { embeds: [embed] });
        if (!sameEmoji(previous.emoji, emoji)) {
          await platform.unreact(channelId, previous.messageId, previous.emoji).catch(() => {});
          await platform.react(channelId, previous.messageId, emoji);
        }
        await store.savePanel(guildId, panelId, channelId, previous.messageId, emoji);
        this.#byMessage.delete(previous.messageId);
        await ctx.record(guildId, actor, 'panel.update', ticketsAudit.auditPublish(panel.name), {
          after: { panelId, channelId, messageId: previous.messageId },
        });
        return 'updated';
      } catch (error) {
        log.info(
          { err: error, guild: guildId, panel: panelId },
          'panel message gone, posting again',
        );
      }
    }

    const messageId = await platform.send(channelId, { embeds: [embed] });
    await platform
      .react(channelId, messageId, emoji)
      .catch((error) => log.warn({ err: error, guild: guildId }, 'panel reaction failed'));
    await store.savePanel(guildId, panelId, channelId, messageId, emoji);
    if (previous) {
      await platform.delete(previous.channelId, previous.messageId).catch(() => {});
      this.#byMessage.delete(previous.messageId);
    }
    await ctx.record(guildId, actor, 'panel.publish', ticketsAudit.auditPublish(panel.name), {
      after: { panelId, channelId, messageId },
      undo: { kind: 'panel.publish', payload: { panelId, messageId } },
    });
    return 'posted';
  }

  async unpublish(guildId: string, panelId: string, messageId?: string): Promise<boolean> {
    const { platform } = this.service.services;
    const published = await this.service.store.panel(guildId, panelId);
    if (!published || (messageId && published.messageId !== messageId)) return false;
    await platform.delete(published.channelId, published.messageId).catch(() => {});
    await this.service.store.removePanel(guildId, panelId, published.messageId);
    this.#byMessage.delete(published.messageId);
    return true;
  }

  async #lookup(messageId: string): Promise<PublishedPanel | null> {
    const hit = this.#byMessage.peek(messageId);
    if (hit) return hit.value;
    const published = await this.service.store.panelByMessage(messageId);
    this.#byMessage.set(messageId, published);
    return published;
  }

  async onReaction(reaction: ReactionEvent): Promise<boolean> {
    const guildId = reaction.guildId;
    if (!guildId) return false;
    const published = await this.#lookup(reaction.messageId);
    if (!published || published.guildId !== guildId) return false;
    if (!sameEmoji(published.emoji, reaction.emoji)) return true;

    const { platform, voice, log } = this.service.services;
    await platform
      .unreact(reaction.channelId, reaction.messageId, reaction.emoji, reaction.userId)
      .catch(() => {});

    const config = await this.service.ctx.config(guildId);
    const panel = config.panels.find((candidate) => candidate.id === published.panelId);
    if (!panel) return true;
    const user = await platform.user(reaction.userId);
    if (!user || user.bot) return true;

    const result = await this.service.open({
      guildId,
      target: panelTarget(panel),
      opener: user,
      source: 'panel',
    });
    if (result.ok) return true;

    if (result.reason === 'limit') {
      const text = copy.alreadyOpen(result.existing.channelId);
      if (!(await platform.sendDirect(user.id, text))) {
        await platform
          .send(reaction.channelId, {
            content: `${mention.user(user.id)} ${text}`,
            mentionUsers: [user.id],
            deleteAfter: 8_000,
          })
          .catch(() => {});
      }
      return true;
    }

    log.warn({ guild: guildId, panel: panel.id, reason: result.reason }, 'ticket open failed');
    if (this.#warned.peek(guildId)) return true;
    this.#warned.set(guildId, true);
    const text =
      result.reason === 'permissions'
        ? voice.botMissingPermissions(result.missing, copy.inCommunity)
        : `${voice.icon('no')}${copy.openFailed}`;
    await platform.send(reaction.channelId, text).catch(() => {});
    return true;
  }
}
