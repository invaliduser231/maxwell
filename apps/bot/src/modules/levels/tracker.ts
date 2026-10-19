import { type LevelsConfig, levelFromXp, type levelsConfig } from '@maxwell/core/modules/levels';
import type { LevelStore } from '@maxwell/core/stores/levels';
import { loadImage } from '@napi-rs/canvas';
import { loadAvatar } from '../../cards/avatar.js';
import { renderLevelUp } from '../../cards/levelup.js';
import { mention } from '../../commands/mentions.js';
import type {
  IncomingMessage,
  MemberJoin,
  OutgoingMessage,
  UserRef,
} from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { copy, levelUpTemplate, milestones } from './copy.js';
import {
  CooldownMap,
  earns,
  newRewards,
  planRewards,
  type RewardPlan,
  renderTemplate,
  rollXp,
} from './xp.js';

type Context = ModuleContext<typeof levelsConfig>;

interface LevelUp {
  guildId: string;
  user: UserRef;
  channelId: string;
  roles: readonly string[];
  from: number;
  to: number;
  config: LevelsConfig;
}

const WARN_LIMIT = 5_000;

export class LevelTracker {
  readonly #cooldowns = new CooldownMap();
  readonly #warned = new Set<string>();

  constructor(
    private readonly ctx: Context,
    private readonly store: LevelStore,
  ) {}

  async onMessage(message: IncomingMessage): Promise<void> {
    if (!message.guildId || message.author.bot || message.fromWebhook) return;
    const guildId = message.guildId;
    const key = `${guildId}:${message.author.id}`;
    if (!this.#cooldowns.ready(key)) return;

    const config = await this.ctx.config(guildId);
    if (!earns(config, message.channelId, message.memberRoles)) return;
    this.#cooldowns.hold(key, config.cooldownSeconds * 1000);

    const gain = rollXp(config, message.channelId, message.memberRoles);
    if (gain <= 0) return;
    const xp = await this.store.award(guildId, message.author.id, gain, config.cooldownSeconds);
    if (xp === null) return;

    const from = levelFromXp(xp - gain, config.curve).level;
    const to = levelFromXp(xp, config.curve).level;
    if (to <= from) return;
    await this.#levelUp({
      guildId,
      user: message.author,
      channelId: message.channelId,
      roles: message.memberRoles,
      from,
      to,
      config,
    });
  }

  async onJoin(join: MemberJoin): Promise<void> {
    if (join.user.bot) return;
    const xp = await this.store.xp(join.guildId, join.user.id);
    if (xp <= 0) return;
    const config = await this.ctx.config(join.guildId);
    if (config.rewards.length === 0) return;
    const level = levelFromXp(xp, config.curve).level;
    const plan = planRewards(config.rewards, level, config.removePreviousRewards, []);
    await this.#apply(join.guildId, join.user.id, plan, level);
  }

  async sync(guildId: string, userId: string, xp: number): Promise<void> {
    const config = await this.ctx.config(guildId);
    if (config.rewards.length === 0) return;
    const member = await this.ctx.services.platform.member(guildId, userId);
    if (!member) return;
    const level = levelFromXp(xp, config.curve).level;
    const plan = planRewards(
      config.rewards,
      level,
      config.removePreviousRewards,
      member.roles,
      true,
    );
    await this.#apply(guildId, userId, plan, level);
  }

  async #levelUp(event: LevelUp): Promise<void> {
    const { guildId, user, config } = event;
    const plan = planRewards(config.rewards, event.to, config.removePreviousRewards, event.roles);
    const added = await this.#apply(guildId, user.id, plan, event.to);
    const earned = newRewards(config.rewards, event.from, event.to).find((reward) =>
      added.includes(reward.roleId),
    );
    await this.#announce(event, earned?.roleId ?? null);
  }

  async #apply(
    guildId: string,
    userId: string,
    plan: RewardPlan,
    level: number,
  ): Promise<string[]> {
    const { platform } = this.ctx.services;
    const reason = copy.rewardReason(level);
    const added: string[] = [];
    for (const roleId of plan.add) {
      try {
        await platform.addRole(guildId, userId, roleId, reason);
        added.push(roleId);
      } catch (error) {
        this.#warn(guildId, `add:${roleId}`, error, 'level reward could not be given');
      }
    }
    for (const roleId of plan.remove) {
      await platform.removeRole(guildId, userId, roleId, reason).catch((error) => {
        this.#warn(guildId, `remove:${roleId}`, error, 'old level reward could not be removed');
      });
    }
    return added;
  }

  async #announce(event: LevelUp, rewardId: string | null): Promise<void> {
    const { guildId, user, config } = event;
    if (config.announce === 'off') return;
    const { platform } = this.ctx.services;

    const [guild, roles] = await Promise.all([
      platform.guild(guildId).catch(() => null),
      rewardId ? platform.roles(guildId).catch(() => []) : Promise.resolve([]),
    ]);
    const role = rewardId ? roles.find((entry) => entry.id === rewardId) : undefined;
    const template = levelUpTemplate(role ? config.rewardMessage : config.message, Boolean(role));
    const text = renderTemplate(template, {
      user: mention.user(user.id),
      name: user.displayName,
      level: event.to,
      role: role?.name ?? '',
      server: guild?.name ?? '',
    });

    const target =
      config.announce === 'dm'
        ? null
        : config.announce === 'channel' && config.announceChannelId
          ? config.announceChannelId
          : event.channelId;

    const out: OutgoingMessage = { content: text, silent: true };
    if (config.card && (await this.#canAttach(guildId, target))) {
      const card = await this.#card(event, role ? { name: role.name, color: role.color } : null);
      if (card) out.files = [{ name: 'level-up.png', data: card }];
    }

    try {
      if (target === null) await platform.sendDirect(user.id, out);
      else await platform.send(target, out);
    } catch (error) {
      this.#warn(guildId, `announce:${target}`, error, 'level-up message could not be sent');
    }
  }

  async #canAttach(guildId: string, channelId: string | null): Promise<boolean> {
    if (channelId === null) return true;
    const missing = await this.ctx.services.platform
      .missingBotPermissions(guildId, channelId, ['AttachFiles'])
      .catch(() => ['AttachFiles']);
    return missing.length === 0;
  }

  async #card(
    event: LevelUp,
    reward: { name: string; color: number } | null,
  ): Promise<Uint8Array | null> {
    const { cards, mascot } = this.ctx.services;
    try {
      const style = await cards.forGuild(event.guildId);
      const face = await loadAvatar(event.user.avatarUrl, event.user.displayName, style.theme);
      const art = milestones.has(event.to) ? mascot.get('happy') : null;
      return await renderLevelUp({
        name: event.user.displayName,
        avatar: face,
        level: event.to,
        reward: reward
          ? {
              name: reward.name,
              color: reward.color ? `#${reward.color.toString(16).padStart(6, '0')}` : undefined,
            }
          : undefined,
        mascot: art ? await loadImage(Buffer.from(art.file.data)) : undefined,
        style,
      });
    } catch (error) {
      this.ctx.services.log.warn({ err: error, guild: event.guildId }, 'level-up card failed');
      return null;
    }
  }

  #warn(guildId: string, what: string, error: unknown, message: string): void {
    const key = `${guildId}:${what}`;
    if (this.#warned.has(key)) return;
    if (this.#warned.size >= WARN_LIMIT) this.#warned.clear();
    this.#warned.add(key);
    this.ctx.services.log.warn({ err: error, guild: guildId }, message);
  }
}
