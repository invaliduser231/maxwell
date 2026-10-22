import type { WelcomeConfig } from '@maxwell/core/modules/welcome';
import { loadAvatar } from '../../cards/avatar.js';
import { renderWelcome } from '../../cards/welcome.js';
import type { GuildRef, MemberJoin, MemberLeave, UserRef } from '../../platform/types.js';
import type { Services } from '../../services.js';
import { Recent } from '../roles/cache.js';
import { cardVariables, memberVariables, render } from './template.js';

export type GreetingKind = 'join' | 'leave' | 'dm';

const REPEAT_WINDOW = 60_000;

export class Greeter {
  readonly #recent = new Recent<true>(10_000, REPEAT_WINDOW);
  readonly #warned = new Recent<true>(2_000, 6 * 60 * 60_000);

  constructor(private readonly services: Services) {}

  async onJoin(join: MemberJoin, config: WelcomeConfig): Promise<void> {
    if (config.ignoreBots && join.user.bot) return;
    const key = `${join.guildId}:${join.user.id}`;
    if (this.#recent.has(key)) return;
    this.#recent.set(key, true);

    const guild = await this.services.platform.guild(join.guildId);
    await Promise.all([
      config.join.enabled && config.join.channelId
        ? this.greet('join', join.guildId, join.user, guild, config, config.join.channelId)
        : null,
      config.dm.enabled ? this.greet('dm', join.guildId, join.user, guild, config) : null,
    ]);
  }

  async onLeave(leave: MemberLeave, config: WelcomeConfig): Promise<void> {
    if (!config.leave.enabled || !config.leave.channelId) return;
    const user = leave.user ?? (await this.services.platform.user(leave.userId));
    if (!user || (config.ignoreBots && user.bot)) return;
    const guild = await this.services.platform.guild(leave.guildId);
    await this.greet('leave', leave.guildId, user, guild, config, config.leave.channelId);
  }

  async greet(
    kind: GreetingKind,
    guildId: string,
    user: UserRef,
    guild: GuildRef | null,
    config: WelcomeConfig,
    channelId?: string,
  ): Promise<boolean> {
    const { platform, log } = this.services;
    const vars = memberVariables(user, guild);

    if (kind === 'dm') {
      const content = render(config.dm.message, vars).slice(0, 4000);
      return content.trim() ? platform.sendDirect(user.id, content) : false;
    }
    if (!channelId) return false;

    const settings = kind === 'join' ? config.join : config.leave;
    const content = render(settings.message, vars).slice(0, 4000);
    const missing = await platform
      .missingBotPermissions(guildId, channelId, ['ViewChannel', 'SendMessages', 'AttachFiles'])
      .catch(() => null);
    if (!missing || missing.includes('SendMessages') || missing.includes('ViewChannel')) {
      this.#warn(guildId, channelId, kind);
      return false;
    }

    const files =
      settings.card && !missing.includes('AttachFiles')
        ? await this.#card(kind, guildId, user, guild, settings).catch((error) => {
            log.warn({ err: error, guild: guildId }, 'welcome card failed');
            return [];
          })
        : [];
    if (!content.trim() && files.length === 0) return false;

    const ping = kind === 'join' && config.join.ping;
    try {
      await platform.send(channelId, {
        content: content || undefined,
        files,
        mentionUsers: ping ? [user.id] : [],
      });
      return true;
    } catch (error) {
      log.warn({ err: error, guild: guildId, channel: channelId, kind }, 'welcome send failed');
      return false;
    }
  }

  async #card(
    kind: 'join' | 'leave',
    guildId: string,
    user: UserRef,
    guild: GuildRef | null,
    settings: { cardTitle: string; cardSubtitle: string },
  ): Promise<{ name: string; data: Uint8Array }[]> {
    const style = await this.services.cards.forGuild(guildId);
    const avatar = await loadAvatar(user.avatarUrl, user.displayName, style.theme);
    const vars = cardVariables(user, guild);
    const data = await renderWelcome({
      kind: kind === 'join' ? 'welcome' : 'goodbye',
      title: render(settings.cardTitle, vars),
      subtitle: render(settings.cardSubtitle, vars),
      avatar,
      style,
    });
    return [{ name: kind === 'join' ? 'welcome.png' : 'goodbye.png', data }];
  }

  #warn(guildId: string, channelId: string, kind: GreetingKind): void {
    const key = `${guildId}:${channelId}`;
    if (this.#warned.has(key)) return;
    this.#warned.set(key, true);
    this.services.log.warn(
      { guild: guildId, channel: channelId, kind },
      'welcome channel missing or not writable',
    );
  }
}
