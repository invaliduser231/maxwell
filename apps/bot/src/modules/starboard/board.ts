import type { Job } from '@maxwell/core';
import type { StarboardConfig, starboardConfig } from '@maxwell/core/modules/starboard';
import type { StarboardPost, StarboardStore } from '@maxwell/core/stores/starboard';
import type {
  ChannelRef,
  IncomingMessage,
  OutgoingMessage,
  ReactionEvent,
} from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import type { PrivacyHandler } from '../../runtime/privacy.js';
import { Recent } from '../roles/cache.js';
import { displayEmoji, normalizeEmoji, sameEmoji } from '../roles/emoji.js';
import { copy, reasons } from './copy.js';
import { countStars, download, firstImage, imageName, jumpUrl, postEmbed } from './render.js';

type Ctx = ModuleContext<typeof starboardConfig>;

const SYNC_DELAY = 2_000;
const STAR_PAGE = 100;
const STAR_PAGES = 10;

export function isNsfw(channel: ChannelRef | undefined): boolean {
  return channel?.nsfw === true;
}

export function watches(config: StarboardConfig, channelId: string): boolean {
  return (
    config.channelId !== null &&
    channelId !== config.channelId &&
    !config.ignoredChannelIds.includes(channelId)
  );
}

export function storedContent(content: string): string {
  return content.slice(0, 4000);
}

export class Starboard {
  readonly #nsfw = new Recent<boolean>(10_000, 10 * 60_000);

  constructor(
    private readonly ctx: Ctx,
    private readonly store: StarboardStore,
  ) {}

  async onReaction(reaction: ReactionEvent): Promise<void> {
    const guildId = reaction.guildId;
    if (!guildId || reaction.bot) return;
    const config = await this.ctx.config(guildId);
    if (!watches(config, reaction.channelId) || !sameEmoji(reaction.emoji, config.emoji)) return;
    await this.ctx.schedule('sync', {
      guildId,
      payload: { channelId: reaction.channelId, messageId: reaction.messageId },
      runAt: new Date(Date.now() + SYNC_DELAY),
      dedupeKey: `starboard.sync:${reaction.messageId}`,
    });
  }

  async onMessageRemove(guildId: string, channelId: string, messageId: string): Promise<void> {
    const config = await this.ctx.config(guildId);
    if (channelId === config.channelId) {
      await this.store.clearPost(messageId);
      return;
    }
    if (!watches(config, channelId)) return;
    const removed = await this.store.remove(messageId);
    if (removed?.postId) await this.#deletePost(guildId, removed.postId);
  }

  async sync(job: Job): Promise<void> {
    const guildId = job.guildId;
    const { channelId, messageId } = job.payload as { channelId?: string; messageId?: string };
    if (!guildId || !channelId || !messageId) return;
    if (!(await this.ctx.enabled(guildId))) return;
    const config = await this.ctx.config(guildId);
    const boardId = config.channelId;
    const emoji = normalizeEmoji(config.emoji);
    if (!boardId || !emoji || !watches(config, channelId)) return;
    if (config.excludeNsfw && (await this.#isNsfw(guildId, channelId))) return;

    const { platform, log } = this.ctx.services;
    const existing = await this.store.get(messageId);
    const message = await platform.message(channelId, messageId).catch(() => null);
    if (!message) {
      if (existing) {
        if (existing.postId) await this.#deletePost(guildId, existing.postId);
        await this.store.remove(messageId);
      }
      return;
    }
    if ((message.author.bot || message.fromWebhook) && !config.allowBots) return;

    const users = await this.#starrers(channelId, messageId, emoji).catch((error) => {
      log.debug({ err: error, guild: guildId }, 'starboard reaction lookup failed');
      return null;
    });
    if (!users) return;
    const stars = countStars(users, message.author.id, platform.selfId, config.selfStar);

    if (stars < config.threshold) {
      if (!existing) return;
      await this.store.upsert({ ...existing, stars, content: message.content });
      if (existing.postId && config.removeBelowThreshold) {
        await this.#deletePost(guildId, existing.postId);
        await this.store.setPost(messageId, null);
      } else if (existing.postId) {
        await this.#editPost(
          guildId,
          boardId,
          existing,
          existing.postId,
          message,
          stars,
          config,
        ).catch((error) => log.debug({ err: error, guild: guildId }, 'starboard edit failed'));
      }
      return;
    }

    const row = await this.store.upsert({
      messageId,
      guildId,
      channelId,
      authorId: message.author.id,
      stars,
      content: message.content,
    });

    if (row.postId) {
      try {
        await this.#editPost(guildId, boardId, existing ?? row, row.postId, message, stars, config);
        return;
      } catch (error) {
        log.info({ err: error, guild: guildId }, 'starboard post gone, posting again');
        await this.store.setPost(messageId, null);
      }
    }

    const missing = await platform
      .missingBotPermissions(guildId, boardId, ['ViewChannel', 'SendMessages', 'EmbedLinks'])
      .catch(() => null);
    if (!missing || missing.includes('SendMessages') || missing.includes('ViewChannel')) {
      log.warn({ guild: guildId, channel: boardId }, 'starboard channel missing or not writable');
      return;
    }
    const image = firstImage(message.attachments);
    const bytes = image ? await download(image.url) : null;
    const attached = image && bytes ? image : null;
    const postId = await platform.send(boardId, {
      content: copy.starLine(displayEmoji(config.emoji), stars, channelId),
      embeds: [await this.#embed(guildId, message, attached)],
      files: attached && bytes ? [{ name: imageName(attached), data: bytes }] : undefined,
    });
    await this.store.setPost(messageId, postId, attached !== null);
  }

  async #editPost(
    guildId: string,
    boardId: string,
    before: StarboardPost,
    postId: string,
    message: IncomingMessage,
    stars: number,
    config: StarboardConfig,
  ): Promise<void> {
    const edit: OutgoingMessage = {
      content: copy.starLine(displayEmoji(config.emoji), stars, message.channelId),
    };
    if (before.content !== storedContent(message.content)) {
      const image = before.postImage ? firstImage(message.attachments) : null;
      const bytes = image ? await download(image.url) : null;
      if (!image || bytes) {
        edit.embeds = [await this.#embed(guildId, message, image)];
        if (image && bytes) edit.files = [{ name: imageName(image), data: bytes }];
      }
    }
    await this.ctx.services.platform.edit(boardId, postId, edit);
  }

  async #embed(guildId: string, message: IncomingMessage, image: ReturnType<typeof firstImage>) {
    const { platform, config } = this.ctx.services;
    const member = await platform.member(guildId, message.author.id).catch(() => null);
    const jump = jumpUrl(config.FLUXER_WEB_URL, guildId, message.channelId, message.id);
    return postEmbed(message, jump, image, member?.nick);
  }

  async #starrers(channelId: string, messageId: string, emoji: string): Promise<string[]> {
    const { platform } = this.ctx.services;
    const users: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < STAR_PAGES; page++) {
      const batch = await platform.reactionUsers(channelId, messageId, emoji, STAR_PAGE, after);
      users.push(...batch);
      after = batch.at(-1);
      if (batch.length < STAR_PAGE || !after) break;
    }
    return users;
  }

  async #deletePost(guildId: string, postId: string): Promise<void> {
    const config = await this.ctx.config(guildId);
    if (!config.channelId) return;
    await this.ctx.services.platform
      .delete(config.channelId, postId, reasons.removed)
      .catch((error) =>
        this.ctx.services.log.debug({ err: error, guild: guildId }, 'starboard delete failed'),
      );
  }

  async #isNsfw(guildId: string, channelId: string): Promise<boolean> {
    const cached = this.#nsfw.get(channelId);
    if (cached !== undefined) return cached;
    const channels = await this.ctx.services.platform.channels(guildId).catch(() => []);
    for (const channel of channels) this.#nsfw.set(channel.id, isNsfw(channel));
    return this.#nsfw.get(channelId) ?? false;
  }

  noteChannel(channel: ChannelRef): void {
    this.#nsfw.set(channel.id, isNsfw(channel));
  }

  forgetChannel(channelId: string): void {
    this.#nsfw.delete(channelId);
  }

  privacy(): PrivacyHandler {
    return {
      export: async (guildId, userId) => {
        const posts = await this.store.byAuthor(guildId, userId);
        if (posts.length === 0) return null;
        return {
          starredMessages: posts.map((post) => ({
            messageId: post.messageId,
            channelId: post.channelId,
            stars: post.stars,
            content: post.content,
            onBoard: post.postId !== null,
            createdAt: post.createdAt.toISOString(),
          })),
        };
      },
      forget: async (guildId, userId) => {
        const removed = await this.store.forgetAuthor(guildId, userId);
        for (const post of removed) {
          if (post.postId) await this.#deletePost(guildId, post.postId);
        }
      },
    };
  }
}
