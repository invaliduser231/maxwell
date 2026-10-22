import type { Actor, Job } from '@maxwell/core';
import type { WelcomeConfig, welcomeConfig } from '@maxwell/core/modules/welcome';
import type { WelcomeStore } from '@maxwell/core/stores/welcome';
import type { Embed, MemberUpdate, ReactionEvent } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import type { PrivacyHandler } from '../../runtime/privacy.js';
import { lines } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { Recent } from '../roles/cache.js';
import { displayEmoji, normalizeEmoji, sameEmoji } from '../roles/emoji.js';
import {
  HOLD_SETTLE,
  HOLD_WAKE,
  type Holds,
  releasedFromGate,
  waitKey,
  waitPrefix,
  waitUntil,
} from '../roles/held.js';
import { copy, reasons } from './copy.js';

export function gateActive(config: WelcomeConfig): boolean {
  return config.rules.enabled && config.rules.roleId !== null;
}

export function delayGroups(config: WelcomeConfig): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (const { roleId, delayMinutes } of config.delayedRoles) {
    const list = groups.get(delayMinutes) ?? [];
    if (!list.includes(roleId)) list.push(roleId);
    groups.set(delayMinutes, list);
  }
  return groups;
}

export function rulesEmbed(config: WelcomeConfig): Embed {
  return {
    color: palette.north,
    title: config.rules.title || undefined,
    description: lines(
      config.rules.content,
      '',
      copy.rulesHint(displayEmoji(config.rules.emoji)),
    ).slice(0, 4096),
  };
}

export function welcomePrivacy(store: Pick<WelcomeStore, 'acceptedAt' | 'revoke'>): PrivacyHandler {
  return {
    async export(guildId, userId) {
      const acceptedAt = await store.acceptedAt(guildId, userId);
      return acceptedAt ? { rulesAcceptedAt: acceptedAt.toISOString() } : null;
    },
    async forget(guildId, userId) {
      await store.revoke(guildId, userId);
    },
  };
}

type Published = { channelId: string; messageId: string; created: boolean } | null;

function delayedPayload(
  job: Job,
): { userId: string; roleIds: string[]; since: number; minutes: number | null } | null {
  const { userId, roleIds, since, minutes } = job.payload;
  if (typeof userId !== 'string' || !Array.isArray(roleIds)) return null;
  return {
    userId,
    roleIds: roleIds.filter((id): id is string => typeof id === 'string'),
    since: typeof since === 'number' ? since : job.runAt.getTime(),
    minutes: typeof minutes === 'number' ? minutes : null,
  };
}

export class RulesGate {
  readonly #messages = new Recent<string | null>(5_000, 60_000);

  constructor(
    private readonly ctx: ModuleContext<typeof welcomeConfig>,
    private readonly store: WelcomeStore,
    private readonly holds: Holds,
  ) {}

  async messageId(guildId: string, config: WelcomeConfig): Promise<string | null> {
    if (config.rules.messageId) return config.rules.messageId;
    const cached = this.#messages.get(guildId);
    if (cached !== undefined) return cached;
    const row = await this.store.rulesMessage(guildId);
    const id = row?.messageId ?? null;
    this.#messages.set(guildId, id);
    return id;
  }

  forget(guildId: string): void {
    this.#messages.delete(guildId);
  }

  async onReaction(reaction: ReactionEvent, config: WelcomeConfig, added: boolean): Promise<void> {
    const guildId = reaction.guildId;
    if (!guildId || reaction.bot || !gateActive(config) || !config.rules.roleId) return;
    if (!sameEmoji(reaction.emoji, config.rules.emoji)) return;
    if (reaction.messageId !== (await this.messageId(guildId, config))) return;

    const { platform, log } = this.ctx.services;
    const roleId = config.rules.roleId;
    const member = await platform.member(guildId, reaction.userId);
    if (!member || member.user.bot) return;

    if (added) {
      if (await this.holds.held(guildId, reaction.userId, member.roles)) {
        await this.store.accept(guildId, reaction.userId);
        return;
      }
      if (!member.roles.includes(roleId)) {
        try {
          await platform.addRole(guildId, reaction.userId, roleId, reasons.accepted);
        } catch (error) {
          log.warn({ err: error, guild: guildId, role: roleId }, 'rules role could not be given');
          return;
        }
      }
      if (await this.store.accept(guildId, reaction.userId)) {
        await this.scheduleDelayed(guildId, reaction.userId, config, Date.now());
      }
      return;
    }

    if (!config.rules.removeOnUnreact) return;
    await this.store.revoke(guildId, reaction.userId);
    if (!member.roles.includes(roleId)) return;
    await platform
      .removeRole(guildId, reaction.userId, roleId, reasons.unaccepted)
      .catch((error) =>
        log.warn({ err: error, guild: guildId, role: roleId }, 'rules role could not be removed'),
      );
  }

  async onJoin(guildId: string, userId: string, config: WelcomeConfig, at: number): Promise<void> {
    if (!gateActive(config)) {
      await this.scheduleDelayed(guildId, userId, config, at);
      return;
    }
    if (!(await this.store.hasAccepted(guildId, userId))) return;
    if (await this.holds.watching(guildId)) {
      await this.ctx.schedule('rules.restore', {
        guildId,
        payload: { userId, since: at },
        runAt: new Date(Date.now() + HOLD_SETTLE),
        dedupeKey: `welcome.rules:${guildId}:${userId}:${at}`,
      });
      return;
    }
    await this.restore(guildId, userId, at, reasons.returning);
  }

  async restore(guildId: string, userId: string, since: number, reason: string): Promise<void> {
    const config = await this.ctx.config(guildId);
    const roleId = config.rules.roleId;
    if (!gateActive(config) || !roleId) return;
    if (!(await this.store.hasAccepted(guildId, userId))) return;
    const { platform, log } = this.ctx.services;
    const member = await platform.member(guildId, userId);
    if (!member) return;
    if (await this.holds.held(guildId, userId, member.roles)) {
      const runAt = waitUntil(since);
      if (!runAt) return;
      await this.ctx.schedule('rules.restore', {
        guildId,
        payload: { userId, since },
        runAt,
        dedupeKey: waitKey('welcome', guildId, userId, 'rules'),
      });
      return;
    }
    if (!member.roles.includes(roleId)) {
      try {
        await platform.addRole(guildId, userId, roleId, reason);
      } catch (error) {
        log.warn(
          { err: error, guild: guildId, role: roleId },
          'rules role could not be given back',
        );
        return;
      }
    }
    await this.scheduleDelayed(guildId, userId, config, since);
  }

  async restoreJob(job: Job): Promise<void> {
    const guildId = job.guildId;
    const { userId, since } = job.payload;
    if (!guildId || typeof userId !== 'string') return;
    if (!(await this.ctx.enabled(guildId))) return;
    await this.restore(
      guildId,
      userId,
      typeof since === 'number' ? since : job.runAt.getTime(),
      reasons.returning,
    );
  }

  async onMemberUpdate(update: MemberUpdate): Promise<void> {
    const { guildId } = update;
    const userId = update.user.id;
    if (!(await releasedFromGate(this.holds, update))) return;
    await this.holds.wake(waitPrefix('welcome', guildId, userId));
    const config = await this.ctx.config(guildId);
    const roleId = config.rules.roleId;
    if (!gateActive(config) || !roleId || update.roles.includes(roleId)) return;
    if (!(await this.store.hasAccepted(guildId, userId))) return;
    await this.ctx.schedule('rules.restore', {
      guildId,
      payload: { userId, since: Date.now() },
      runAt: new Date(Date.now() + HOLD_WAKE),
      dedupeKey: waitKey('welcome', guildId, userId, 'rules'),
    });
  }

  async scheduleDelayed(
    guildId: string,
    userId: string,
    config: WelcomeConfig,
    from: number,
  ): Promise<void> {
    for (const [minutes, roleIds] of delayGroups(config)) {
      await this.ctx.schedule('roles.grant', {
        guildId,
        payload: { userId, roleIds, since: from, minutes },
        runAt: new Date(from + minutes * 60_000),
        dedupeKey: `welcome.roles:${guildId}:${userId}:${minutes}:${from}`,
      });
    }
  }

  async grantDelayed(job: Job): Promise<void> {
    const guildId = job.guildId;
    const payload = delayedPayload(job);
    if (!guildId || !payload) return;
    if (!(await this.ctx.enabled(guildId))) return;
    const { userId, roleIds } = payload;
    const config = await this.ctx.config(guildId);
    if (gateActive(config) && !(await this.store.hasAccepted(guildId, userId))) return;

    const { platform, log } = this.ctx.services;
    const member = await platform.member(guildId, userId);
    if (!member) return;
    if (await this.holds.held(guildId, userId, member.roles)) {
      const runAt = waitUntil(payload.since);
      if (!runAt) return;
      await this.ctx.schedule('roles.grant', {
        guildId,
        payload: { ...payload },
        runAt,
        dedupeKey: waitKey(
          'welcome',
          guildId,
          userId,
          `roles:${payload.minutes ?? roleIds.join('-')}`,
        ),
      });
      return;
    }
    const wanted = new Set(config.delayedRoles.map((entry) => entry.roleId));
    for (const roleId of roleIds) {
      if (!wanted.has(roleId) || member.roles.includes(roleId)) continue;
      await platform
        .addRole(guildId, userId, roleId, reasons.delayed)
        .catch((error) =>
          log.warn({ err: error, guild: guildId, role: roleId }, 'delayed role could not be given'),
        );
    }
  }

  async publish(guildId: string, actor: Actor): Promise<Published> {
    const config = await this.ctx.config(guildId);
    const { platform, log } = this.ctx.services;
    const channelId = config.rules.channelId;
    const emoji = normalizeEmoji(config.rules.emoji);
    if (!channelId || !emoji) return null;

    if (config.rules.messageId) {
      await platform.react(channelId, config.rules.messageId, emoji);
      this.forget(guildId);
      await this.ctx.record(guildId, actor, 'rules.attach', reasons.audit.rulesAttached, {
        after: { channelId, messageId: config.rules.messageId },
      });
      return { channelId, messageId: config.rules.messageId, created: false };
    }

    const embed = rulesEmbed(config);
    const existing = await this.store.rulesMessage(guildId);
    if (existing && existing.channelId === channelId) {
      try {
        await platform.edit(channelId, existing.messageId, { embeds: [embed] });
        await platform.react(channelId, existing.messageId, emoji);
        await this.ctx.record(guildId, actor, 'rules.update', reasons.audit.rulesUpdated, {
          after: { channelId, messageId: existing.messageId },
        });
        this.forget(guildId);
        return { channelId, messageId: existing.messageId, created: false };
      } catch (error) {
        log.info({ err: error, guild: guildId }, 'rules message gone, posting a new one');
      }
    } else if (existing) {
      await platform.delete(existing.channelId, existing.messageId).catch(() => {});
    }

    const messageId = await platform.send(channelId, { embeds: [embed] });
    await this.store.setRulesMessage(guildId, channelId, messageId);
    this.forget(guildId);
    await platform
      .react(channelId, messageId, emoji)
      .catch((error) => log.warn({ err: error, guild: guildId }, 'rules reaction failed'));
    await this.ctx.record(guildId, actor, 'rules.publish', reasons.audit.rulesPosted, {
      before: existing ? { channelId: existing.channelId, messageId: existing.messageId } : null,
      after: { channelId, messageId },
      undo: { kind: 'rules.unpublish', payload: { channelId, messageId } },
    });
    return { channelId, messageId, created: true };
  }

  async remove(guildId: string, actor: Actor): Promise<boolean> {
    const existing = await this.store.rulesMessage(guildId);
    if (!existing) return false;
    await this.unpublish(guildId, existing.channelId, existing.messageId);
    await this.ctx.record(guildId, actor, 'rules.remove', reasons.audit.rulesRemoved, {
      before: { channelId: existing.channelId, messageId: existing.messageId },
    });
    return true;
  }

  async unpublish(guildId: string, channelId: string, messageId: string): Promise<void> {
    await this.ctx.services.platform.delete(channelId, messageId).catch(() => {});
    await this.store.clearRulesMessage(guildId, messageId);
    this.forget(guildId);
  }
}
