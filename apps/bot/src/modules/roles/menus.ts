import type { Actor, Job } from '@maxwell/core';
import type { RoleMenu, rolesConfig } from '@maxwell/core/modules/roles';
import type { MenuMessage, RolesStore } from '@maxwell/core/stores/roles';
import { Lanes } from '../../commands/lanes.js';
import { mention } from '../../commands/mentions.js';
import type { Embed, ReactionEvent } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { lines } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { Recent } from './cache.js';
import { audit, copy, reasons } from './copy.js';
import { displayEmoji, emojiKey, normalizeEmoji, sameEmoji } from './emoji.js';
import { findEntry, menuEmojis, planReaction } from './plan.js';

type Ctx = ModuleContext<typeof rolesConfig>;

export function menuEmbed(menu: RoleMenu): Embed {
  return {
    color: palette.north,
    title: menu.title || undefined,
    description: lines(
      menu.description || null,
      menu.description ? '' : null,
      ...menu.entries.map((entry) => {
        const label = entry.label ? `  ${entry.label}` : '';
        return `${displayEmoji(entry.emoji)}  ${mention.role(entry.roleId)}${label}`;
      }),
      copy.menuHint(menu.type, menu.durationMinutes, menu.limit) && '',
      copy.menuHint(menu.type, menu.durationMinutes, menu.limit),
    ).slice(0, 4096),
  };
}

export class Menus {
  readonly #links = new Recent<MenuMessage | null>(20_000, 10 * 60_000);
  readonly #ignored = new Recent<true>(5_000, 10_000);
  readonly #seen = new Recent<boolean>(20_000, 60_000);
  readonly #lanes = new Lanes();

  constructor(
    private readonly ctx: Ctx,
    private readonly store: RolesStore,
  ) {}

  async #link(messageId: string): Promise<MenuMessage | null> {
    const cached = this.#links.get(messageId);
    if (cached !== undefined) return cached;
    const row = await this.store.menuByMessage(messageId);
    this.#links.set(messageId, row);
    return row;
  }

  onReaction(reaction: ReactionEvent, added: boolean): Promise<void> {
    const guildId = reaction.guildId;
    if (!guildId) return Promise.resolve();
    if (reaction.userId === this.ctx.services.platform.selfId) {
      return added ? Promise.resolve() : this.#heal(guildId, reaction);
    }
    if (reaction.bot) return Promise.resolve();
    return this.#lanes.run(
      `${guildId}:${reaction.userId}`,
      () => this.#handle(guildId, reaction, added),
      (error) => this.ctx.services.log.warn({ err: error, guild: guildId }, 'menu reaction failed'),
    );
  }

  async #heal(guildId: string, reaction: ReactionEvent): Promise<void> {
    const link = await this.#link(reaction.messageId);
    if (!link || link.guildId !== guildId) return;
    if (!link.emojis.some((emoji) => sameEmoji(emoji, reaction.emoji))) return;
    const menu = (await this.ctx.config(guildId)).menus.find((item) => item.id === link.menuId);
    if (!menu || !findEntry(menu, reaction.emoji)) return;
    await this.ctx.services.platform
      .react(reaction.channelId, reaction.messageId, reaction.emoji)
      .catch((error) =>
        this.ctx.services.log.debug({ err: error, guild: guildId }, 'menu reaction not restored'),
      );
  }

  async onRoleDelete(guildId: string, roleId: string): Promise<void> {
    const config = await this.ctx.config(guildId);
    const touched = config.menus.filter((menu) =>
      menu.entries.some((entry) => entry.roleId === roleId),
    );
    if (touched.length === 0) return;
    await this.ctx.update(
      guildId,
      {
        menus: config.menus.map((menu) => ({
          ...menu,
          entries: menu.entries.filter((entry) => entry.roleId !== roleId),
        })),
      },
      { id: null },
      audit.menuRoleGone(touched.length),
    );
    for (const menu of touched) {
      if (!(await this.store.menuMessage(guildId, menu.id))) continue;
      await this.publish(guildId, menu.id, { id: null }).catch((error) =>
        this.ctx.services.log.warn({ err: error, guild: guildId }, 'menu refresh failed'),
      );
    }
  }

  #skipEcho(messageId: string, userId: string, emoji: string): void {
    const key = `${messageId}:${userId}:${emojiKey(emoji)}`;
    this.#ignored.set(key, true);
    this.#seen.set(key, false);
  }

  async #handle(guildId: string, reaction: ReactionEvent, added: boolean): Promise<void> {
    const link = await this.#link(reaction.messageId);
    if (!link || link.guildId !== guildId) return;

    const skipKey = `${reaction.messageId}:${reaction.userId}:${emojiKey(reaction.emoji)}`;
    if (!added && this.#ignored.has(skipKey)) {
      this.#ignored.delete(skipKey);
      return;
    }
    if (this.#seen.get(skipKey) === added) return;
    this.#seen.set(skipKey, added);

    const config = await this.ctx.config(guildId);
    const menu = config.menus.find((candidate) => candidate.id === link.menuId);
    if (!menu) return;
    const entry = findEntry(menu, reaction.emoji);
    if (!entry) return;

    const { platform, log } = this.ctx.services;
    const member = await platform.member(guildId, reaction.userId);
    if (!member || member.user.bot) return;

    const plan = planReaction(menu, entry, member.roles, added);
    for (const roleId of plan.remove) {
      await platform
        .removeRole(guildId, reaction.userId, roleId, added ? reasons.menuSwap : reasons.menu)
        .catch((error) => log.warn({ err: error, guild: guildId, role: roleId }, 'menu role'));
      if (menu.type === 'temporary') {
        await this.store.removeTemporary(guildId, reaction.userId, roleId);
      }
    }
    for (const emoji of plan.unreact) {
      this.#skipEcho(reaction.messageId, reaction.userId, emoji);
      await platform
        .unreact(reaction.channelId, reaction.messageId, emoji, reaction.userId)
        .catch(() => {});
    }
    for (const roleId of plan.add) {
      try {
        await platform.addRole(guildId, reaction.userId, roleId, reasons.menu);
      } catch (error) {
        log.warn({ err: error, guild: guildId, role: roleId }, 'menu role could not be given');
        return;
      }
    }
    if (plan.temporary) {
      const expiresAt = new Date(Date.now() + menu.durationMinutes * 60_000);
      await this.store.setTemporary(guildId, reaction.userId, entry.roleId, expiresAt);
      await this.ctx.schedule('temp.expire', {
        guildId,
        payload: { userId: reaction.userId, roleId: entry.roleId },
        runAt: expiresAt,
        dedupeKey: `roles.temp:${guildId}:${reaction.userId}:${entry.roleId}:${expiresAt.getTime()}`,
      });
    }
  }

  async expire(job: Job): Promise<void> {
    const guildId = job.guildId;
    const { userId, roleId } = job.payload as { userId?: string; roleId?: string };
    if (!guildId || !userId || !roleId) return;
    const row = await this.store.temporary(guildId, userId, roleId);
    if (!row || row.expiresAt.getTime() > Date.now() + 1_000) return;

    const { platform, log } = this.ctx.services;
    const member = await platform.member(guildId, userId);
    if (member?.roles.includes(roleId)) {
      await platform.removeRole(guildId, userId, roleId, reasons.temporaryEnded);
    }
    await this.store.removeTemporary(guildId, userId, roleId);

    const config = await this.ctx.config(guildId);
    for (const menu of config.menus) {
      const entry = menu.entries.find((candidate) => candidate.roleId === roleId);
      const emoji = entry ? normalizeEmoji(entry.emoji) : null;
      if (!entry || !emoji) continue;
      const published = await this.store.menuMessage(guildId, menu.id);
      if (!published) continue;
      this.#skipEcho(published.messageId, userId, emoji);
      await platform
        .unreact(published.channelId, published.messageId, emoji, userId)
        .catch((error) => log.debug({ err: error, guild: guildId }, 'temporary unreact failed'));
    }
  }

  async publish(guildId: string, menuId: string, actor: Actor): Promise<boolean> {
    const config = await this.ctx.config(guildId);
    const menu = config.menus.find((candidate) => candidate.id === menuId);
    const { platform, log } = this.ctx.services;
    if (!menu?.channelId) {
      log.info({ guild: guildId, menu: menuId }, 'menu has no channel, nothing to post');
      return false;
    }

    const emojis = menuEmojis(menu);
    const embed = menuEmbed(menu);
    const existing = await this.store.menuMessage(guildId, menu.id);

    if (existing && existing.channelId === menu.channelId) {
      try {
        await platform.edit(menu.channelId, existing.messageId, { embeds: [embed] });
        for (const old of existing.emojis) {
          if (emojis.some((emoji) => sameEmoji(emoji, old))) continue;
          await platform.unreact(menu.channelId, existing.messageId, old).catch(() => {});
        }
        await this.#react(menu.channelId, existing.messageId, emojis, guildId);
        await this.store.saveMenuMessage(
          guildId,
          menu.id,
          menu.channelId,
          existing.messageId,
          emojis,
        );
        this.#links.delete(existing.messageId);
        await this.ctx.record(guildId, actor, 'menu.update', audit.menuUpdated(menu.title), {
          after: { menuId: menu.id, channelId: menu.channelId, messageId: existing.messageId },
        });
        return true;
      } catch (error) {
        log.info({ err: error, guild: guildId, menu: menu.id }, 'menu message gone, reposting');
      }
    } else if (existing) {
      await platform.delete(existing.channelId, existing.messageId).catch(() => {});
      this.#links.delete(existing.messageId);
    }

    const messageId = await platform.send(menu.channelId, { embeds: [embed] });
    await this.store.saveMenuMessage(guildId, menu.id, menu.channelId, messageId, emojis);
    this.#links.delete(messageId);
    await this.#react(menu.channelId, messageId, emojis, guildId);
    await this.ctx.record(guildId, actor, 'menu.publish', audit.menuPosted(menu.title), {
      before: existing ? { channelId: existing.channelId, messageId: existing.messageId } : null,
      after: { menuId: menu.id, channelId: menu.channelId, messageId },
      undo: {
        kind: 'menu.unpublish',
        payload: { menuId: menu.id, channelId: menu.channelId, messageId },
      },
    });
    return true;
  }

  async remove(guildId: string, menuId: string, actor: Actor): Promise<boolean> {
    const existing = await this.store.menuMessage(guildId, menuId);
    if (!existing) return false;
    await this.unpublish(guildId, menuId, existing.channelId, existing.messageId);
    const config = await this.ctx.config(guildId);
    const title = config.menus.find((menu) => menu.id === menuId)?.title ?? menuId;
    await this.ctx.record(guildId, actor, 'menu.remove', audit.menuRemoved(title), {
      before: { menuId, channelId: existing.channelId, messageId: existing.messageId },
    });
    return true;
  }

  async unpublish(
    guildId: string,
    menuId: string,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    await this.ctx.services.platform.delete(channelId, messageId).catch(() => {});
    await this.store.removeMenuMessage(guildId, menuId, messageId);
    this.#links.delete(messageId);
  }

  async onMessageRemove(messageId: string): Promise<void> {
    const link = await this.#link(messageId);
    if (!link) return;
    await this.store.removeMenuByMessage(messageId);
    this.#links.delete(messageId);
  }

  async #react(
    channelId: string,
    messageId: string,
    emojis: string[],
    guildId: string,
  ): Promise<void> {
    for (const emoji of emojis) {
      await this.ctx.services.platform.react(channelId, messageId, emoji).catch((error) => {
        this.ctx.services.log.warn(
          { err: error, guild: guildId, emoji },
          'menu reaction could not be added',
        );
      });
    }
  }
}
