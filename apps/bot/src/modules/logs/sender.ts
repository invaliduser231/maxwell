import type { OutgoingMessage } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import {
  hasIgnoredRole,
  isIgnoredChannel,
  type LogEvent,
  type LogsConfig,
  type logsConfig,
  routeFor,
} from './config.js';

const WARN_EVERY = 60 * 60_000;
const PARENT_TTL = 5 * 60_000;

export interface Scope {
  channelId?: string | null;
  roles?: readonly string[];
  bot?: boolean;
}

type Ctx = ModuleContext<typeof logsConfig>;

export class LogSender {
  readonly #warned = new Map<string, number>();
  readonly #parents = new Map<string, { parentId: string | null; at: number }>();

  constructor(private readonly ctx: Ctx) {}

  async target(guildId: string, event: LogEvent, scope: Scope = {}): Promise<string | null> {
    const config = await this.ctx.config(guildId);
    const channelId = routeFor(config, event);
    if (!channelId) return null;
    if (scope.bot && config.ignoreBots) return null;
    if (scope.roles && hasIgnoredRole(config, scope.roles)) return null;
    if (scope.channelId && (await this.#ignored(config, guildId, scope.channelId))) return null;
    return channelId;
  }

  async send(
    guildId: string,
    event: LogEvent,
    scope: Scope,
    build: () => OutgoingMessage | null | Promise<OutgoingMessage | null>,
  ): Promise<void> {
    const channelId = await this.target(guildId, event, scope);
    if (!channelId) return;
    const message = await build();
    if (!message) return;
    await this.deliver(guildId, channelId, message);
  }

  async deliver(guildId: string, channelId: string, message: OutgoingMessage): Promise<boolean> {
    const { platform } = this.ctx.services;
    try {
      if (!(await platform.channelInGuild(guildId, channelId))) {
        throw new Error('log channel not in this community');
      }
      await platform.send(channelId, { ...message, silent: true });
      return true;
    } catch (error) {
      const last = this.#warned.get(channelId) ?? 0;
      if (Date.now() - last > WARN_EVERY) {
        this.#warned.set(channelId, Date.now());
        if (this.#warned.size > 5_000) this.#warned.clear();
        this.ctx.services.log.warn(
          { err: error, guild: guildId, channel: channelId, module: 'logs' },
          'log channel unusable',
        );
      }
      return false;
    }
  }

  async #ignored(config: LogsConfig, guildId: string, channelId: string): Promise<boolean> {
    if (config.ignoredChannelIds.length === 0) return false;
    if (config.ignoredChannelIds.includes(channelId)) return true;
    return isIgnoredChannel(config, channelId, await this.#parent(guildId, channelId));
  }

  async #parent(guildId: string, channelId: string): Promise<string | null> {
    const hit = this.#parents.get(channelId);
    if (hit && Date.now() - hit.at < PARENT_TTL) return hit.parentId;
    const channels = await this.ctx.services.platform.channels(guildId).catch(() => []);
    const now = Date.now();
    if (this.#parents.size > 20_000) this.#parents.clear();
    for (const channel of channels) {
      this.#parents.set(channel.id, { parentId: channel.parentId, at: now });
    }
    return this.#parents.get(channelId)?.parentId ?? null;
  }
}
