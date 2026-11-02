import {
  type Counter,
  type CountersConfig,
  type CounterValues,
  counterName,
  type countersConfig,
} from '@maxwell/core/modules/counters';
import { generalConfig } from '@maxwell/core/modules/general';
import { inGuild, locale } from '../../i18n/language.js';
import { ChannelKind } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { audit, reasons } from './copy.js';

type Ctx = ModuleContext<typeof countersConfig>;

export const RENAME_GAP = 5 * 60_000;
const COUNTS_WAIT = 3_000;

export function todayIn(timezone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export class CounterBoard {
  readonly #renamed = new Map<string, number>();

  constructor(
    private readonly ctx: Ctx,
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async #active(guildId: string): Promise<CountersConfig | null> {
    if (!(await this.ctx.enabled(guildId))) return null;
    const config = await this.ctx.config(guildId);
    return config.counters.length > 0 ? config : null;
  }

  async values(guildId: string, now = new Date()): Promise<CounterValues> {
    const { platform, settings } = this.ctx.services;
    const [roles, channels, general] = await Promise.all([
      platform.roles(guildId),
      platform.channels(guildId),
      settings.config(guildId, 'general', generalConfig),
    ]);
    const counts = platform.counts(guildId);
    const voice = channels
      .filter((channel) => channel.type === ChannelKind.Voice)
      .reduce((sum, channel) => sum + platform.voiceMembers(guildId, channel.id).length, 0);
    return {
      members: counts?.members ?? null,
      online: counts?.online ?? null,
      voice,
      channels: channels.filter((channel) => channel.type !== ChannelKind.Category).length,
      roles: roles.filter((role) => role.id !== guildId).length,
      today: todayIn(general.timezone, now),
    };
  }

  async refresh(guildId: string, now = new Date(), requested = false): Promise<number> {
    const config = await this.#active(guildId);
    if (!config) return 0;
    const { platform, log } = this.ctx.services;
    const counts = platform.counts(guildId);
    if (!requested && (counts?.members == null || counts.online == null)) {
      platform.requestCounts([guildId]);
      await this.wait(COUNTS_WAIT);
    }
    return inGuild(guildId, async () => {
      const values = await this.values(guildId, now);
      const live = new Map(
        (await platform.channels(guildId)).map((channel) => [channel.id, channel]),
      );
      let renamed = 0;
      for (const item of config.counters) {
        const channel = live.get(item.channelId);
        if (!channel) continue;
        const name = counterName(item, values, locale());
        if (!name || name === channel.name) continue;
        const last = this.#renamed.get(item.channelId);
        if (last !== undefined && now.getTime() - last < RENAME_GAP) continue;
        this.#renamed.set(item.channelId, now.getTime());
        try {
          await platform.editChannel(item.channelId, { name }, reasons.update);
          renamed++;
        } catch (error) {
          log.warn(
            { err: error, guild: guildId, channel: item.channelId },
            'counter rename failed',
          );
        }
      }
      return renamed;
    });
  }

  async tick(guildIds: readonly string[], now = new Date()): Promise<number> {
    const { platform, log } = this.ctx.services;
    const due: string[] = [];
    for (const guildId of guildIds) {
      try {
        if (await this.#active(guildId)) due.push(guildId);
      } catch (error) {
        log.warn({ err: error, guild: guildId }, 'counter check failed');
      }
    }
    if (due.length === 0) return 0;
    platform.requestCounts(due);
    await this.wait(COUNTS_WAIT);
    let renamed = 0;
    for (const guildId of due) {
      try {
        renamed += await this.refresh(guildId, now, true);
      } catch (error) {
        log.warn({ err: error, guild: guildId }, 'counter refresh failed');
      }
    }
    return renamed;
  }

  async add(guildId: string, item: Counter, by: string): Promise<void> {
    const config = await this.ctx.config(guildId);
    await this.ctx.update(
      guildId,
      {
        counters: [...config.counters.filter((entry) => entry.channelId !== item.channelId), item],
      },
      { id: by },
      audit.added(item.type),
    );
  }

  async forgetChannel(guildId: string, channelId: string): Promise<void> {
    this.#renamed.delete(channelId);
    const config = await this.ctx.config(guildId);
    if (!config.counters.some((entry) => entry.channelId === channelId)) return;
    await this.ctx.update(
      guildId,
      { counters: config.counters.filter((entry) => entry.channelId !== channelId) },
      { id: null },
      audit.channelGone,
    );
  }
}
