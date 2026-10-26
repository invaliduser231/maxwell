import { automodConfig } from '@maxwell/core/modules/automod';
import type { SecurityConfig, securityConfig } from '@maxwell/core/modules/security';
import type { AutomodStore } from '@maxwell/core/stores/automod';
import { mention } from '../../commands/mentions.js';
import type { Embed } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { lines } from '../../ui/format.js';
import { reasons } from './copy.js';

export type Ctx = ModuleContext<typeof securityConfig>;
export type Punishment = 'kick' | 'ban' | 'softban';

const SOFTBAN_SECONDS = 3_600;
const SOFTBAN_LIFT_MS = 5_000;

export class Guard {
  constructor(
    readonly ctx: Ctx,
    private readonly automod: AutomodStore,
  ) {}

  async gate(guildId: string): Promise<{ roleId: string | null; channelId: string | null }> {
    const config = await this.ctx.services.settings.config(guildId, 'automod', automodConfig);
    return { roleId: config.raid.gateRoleId, channelId: config.raid.gateChannelId };
  }

  async hold(guildId: string, userId: string, reason: 'verify' | 'honeypot'): Promise<boolean> {
    const { roleId } = await this.gate(guildId);
    if (!roleId) return false;
    try {
      await this.ctx.services.platform.addRole(guildId, userId, roleId, reasons.gate);
    } catch (error) {
      this.ctx.services.log.warn({ err: error, guild: guildId }, 'security gate role failed');
      return false;
    }
    await this.automod.hold(guildId, userId, null, reason);
    return true;
  }

  async release(guildId: string, userId: string, by: string | null): Promise<boolean> {
    const { platform, log } = this.ctx.services;
    const { roleId } = await this.gate(guildId);
    if (roleId) {
      try {
        await platform.removeRole(guildId, userId, roleId, reasons.passed);
      } catch (error) {
        log.warn({ err: error, guild: guildId }, 'security gate role could not be removed');
        return false;
      }
    }
    await this.automod.resolveHeld(guildId, [userId], 'let_in', by);
    return true;
  }

  async punish(
    guildId: string,
    userId: string,
    action: Punishment,
    reason: string,
    deleteMessageSeconds: number | null = null,
  ): Promise<void> {
    const { jobs } = this.ctx.services;
    if (action === 'softban') {
      await jobs.enqueue({
        kind: 'moderation.action',
        guildId,
        payload: {
          action: 'ban',
          userId,
          reason,
          source: 'security',
          deleteMessageSeconds: SOFTBAN_SECONDS,
        },
      });
      await jobs.enqueue({
        kind: 'moderation.action',
        guildId,
        payload: { action: 'unban', userId, reason: reasons.softbanLift, source: 'security' },
        runAt: new Date(Date.now() + SOFTBAN_LIFT_MS),
      });
      return;
    }
    await jobs.enqueue({
      kind: 'moderation.action',
      guildId,
      payload: { action, userId, reason, source: 'security', deleteMessageSeconds },
    });
  }

  async post(
    guildId: string,
    config: SecurityConfig,
    message: { content?: string; embed?: Embed; ping?: boolean },
  ): Promise<{ channelId: string; messageId: string } | null> {
    const channelId = config.logChannelId;
    if (!channelId) return null;
    const { platform, log } = this.ctx.services;
    const alertRole = message.ping ? config.alertRoleId : null;
    try {
      const messageId = await platform.send(channelId, {
        content:
          lines(alertRole ? mention.role(alertRole) : null, message.content ?? null) || undefined,
        embeds: message.embed ? [message.embed] : undefined,
        mentionRoles: alertRole ? [alertRole] : [],
        silent: !message.ping,
      });
      return { channelId, messageId };
    } catch (error) {
      log.warn({ err: error, guild: guildId }, 'security log failed');
      return null;
    }
  }
}
