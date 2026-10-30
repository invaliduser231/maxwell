import type { Actor } from '@maxwell/core';
import type { HoneypotAction } from '@maxwell/core/modules/security';
import type { SecurityStore } from '@maxwell/core/stores/security';
import { ChannelKind, type IncomingMessage, type MemberUpdate } from '../../platform/types.js';
import { palette } from '../../ui/palette.js';
import { audit, copy, reasons } from './copy.js';
import type { Ctx, Guard } from './guard.js';

const COOLDOWN = 60_000;
const CLEAN_SECONDS = 3_600;

export class Honeypot {
  readonly #recent = new Map<string, number>();

  constructor(
    private readonly ctx: Ctx,
    private readonly store: SecurityStore,
    private readonly guard: Guard,
    private readonly now: () => number = Date.now,
  ) {}

  #fresh(guildId: string, userId: string): boolean {
    const key = `${guildId}:${userId}`;
    const at = this.now();
    const last = this.#recent.get(key);
    if (last !== undefined && at - last < COOLDOWN) return false;
    this.#recent.set(key, at);
    if (this.#recent.size > 10_000) {
      const first = this.#recent.keys().next().value;
      if (first !== undefined) this.#recent.delete(first);
    }
    return true;
  }

  async onMessage(message: IncomingMessage): Promise<boolean> {
    const guildId = message.guildId;
    if (!guildId || message.author.bot || message.fromWebhook) return false;
    const { platform } = this.ctx.services;
    if (message.author.id === platform.selfId) return false;
    const config = await this.ctx.config(guildId);
    const settings = config.honeypot;
    if (!settings.enabled || !settings.channelIds.includes(message.channelId)) return false;
    if (settings.exemptMods) {
      const mod = await platform
        .hasPermissions(guildId, message.author.id, message.channelId, ['ManageMessages'])
        .catch(() => false);
      if (mod) return false;
    }
    await platform.delete(message.channelId, message.id).catch(() => {});
    if (!this.#fresh(guildId, message.author.id)) return true;
    await this.#catch(guildId, message.author.id, settings.action, message.channelId);
    return true;
  }

  async onMemberUpdate(update: MemberUpdate): Promise<void> {
    if (!update.before || update.user.bot) return;
    const config = await this.ctx.config(update.guildId);
    const settings = config.honeypot;
    const roleId = settings.roleId;
    if (!settings.enabled || !roleId) return;
    if (update.before.roles.includes(roleId) || !update.roles.includes(roleId)) return;
    if (!this.#fresh(update.guildId, update.user.id)) return;
    await this.#catch(update.guildId, update.user.id, settings.action, null);
  }

  async #catch(
    guildId: string,
    userId: string,
    action: HoneypotAction,
    channelId: string | null,
  ): Promise<void> {
    const reason = channelId ? reasons.honeypot : reasons.honeypotRole;
    if (action === 'quarantine') {
      await this.guard.hold(guildId, userId, 'honeypot');
    } else if (action === 'ban') {
      await this.guard.punish(guildId, userId, 'ban', reason, CLEAN_SECONDS);
      await this.guard.share(guildId, userId, 'honeypot');
    } else {
      await this.guard.punish(guildId, userId, 'softban', reason);
      await this.guard.share(guildId, userId, 'honeypot');
    }
    const config = await this.ctx.config(guildId);
    await this.store.event({
      guildId,
      kind: 'honeypot',
      userId,
      actorId: null,
      summary: action,
      detail: { channelId, action },
    });
    const what = copy.honeypot.actions[action];
    await this.guard.post(guildId, config, {
      embed: {
        color: palette.danger,
        description: channelId
          ? copy.honeypot.caught(userId, channelId, what)
          : copy.honeypot.caughtRole(userId, what),
        timestamp: new Date(this.now()),
      },
    });
  }

  async setup(guildId: string, by: Actor): Promise<string | null> {
    const { platform, log } = this.ctx.services;
    const config = await this.ctx.config(guildId);
    if (config.honeypot.channelIds.length >= 5) return null;
    let channelId: string;
    try {
      channelId = await platform.createChannel(
        guildId,
        { name: reasons.channelName, type: ChannelKind.Text, topic: copy.honeypot.topic },
        reasons.honeypotChannel,
      );
    } catch (error) {
      log.warn({ err: error, guild: guildId }, 'honeypot channel could not be created');
      return null;
    }
    await platform
      .send(channelId, {
        embeds: [{ color: palette.danger, description: copy.honeypot.warning }],
      })
      .catch(() => undefined);
    await this.ctx.update(
      guildId,
      {
        honeypot: {
          ...config.honeypot,
          enabled: true,
          channelIds: [...config.honeypot.channelIds, channelId],
        },
      },
      by,
      audit.honeypot,
    );
    return channelId;
  }
}
