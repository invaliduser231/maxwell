import type { SlowmodeStore } from '@maxwell/core/stores/slowmode';
import { formatDuration } from '../../commands/duration.js';
import { mention } from '../../commands/mentions.js';
import { inGuild } from '../../i18n/language.js';
import type { ChannelChange, ChannelRef } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { audit, copy } from './copy.js';
import type { AdaptiveSlowmodeConfig, AutomodConfig, automodConfig } from './types.js';

const WINDOW = 60_000;
const CALM = 0.5;
const TICK = 15_000;
const CHECK_EVERY = 5_000;
const RATE_CAP = 5_000;
const MAX_CHANNELS = 5_000;

export type SlowmodeSettings = Pick<
  AdaptiveSlowmodeConfig,
  'maxPerMinute' | 'minSeconds' | 'maxSeconds' | 'stepSeconds' | 'cooldownSeconds'
>;

export interface Held {
  original: number;
  applied: number;
  changedAt: number;
}

export type SlowmodeStep =
  | { kind: 'none' }
  | { kind: 'raise' | 'lower' | 'restore'; seconds: number };

const NONE: SlowmodeStep = { kind: 'none' };

export function nextSlowmode(input: {
  rate: number;
  current: number;
  held: Held | null;
  settings: SlowmodeSettings;
  now: number;
}): SlowmodeStep {
  const { rate, current, held, settings, now } = input;
  const low = settings.minSeconds;
  const high = Math.max(low, settings.maxSeconds);
  const step = Math.max(1, settings.stepSeconds);
  const busy = rate > settings.maxPerMinute;
  if (!held) {
    if (!busy) return NONE;
    const seconds = Math.min(high, Math.max(low, current + step));
    return seconds > current ? { kind: 'raise', seconds } : NONE;
  }
  if (now - held.changedAt < settings.cooldownSeconds * 1_000) return NONE;
  if (busy) {
    const seconds = Math.min(high, held.applied + step);
    return seconds > held.applied ? { kind: 'raise', seconds } : NONE;
  }
  if (rate > settings.maxPerMinute * CALM) return NONE;
  const seconds = held.applied - step;
  if (seconds < low || seconds <= held.original) return { kind: 'restore', seconds: held.original };
  return { kind: 'lower', seconds };
}

function evict<V>(map: Map<string, V>, cap: number): void {
  while (map.size >= cap) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export class RateCounter {
  readonly #times = new Map<string, number[]>();

  constructor(private readonly maxKeys = MAX_CHANNELS) {}

  add(key: string, at: number): void {
    let times = this.#times.get(key);
    if (times) {
      this.#times.delete(key);
    } else {
      times = [];
      evict(this.#times, this.maxKeys);
    }
    times.push(at);
    if (times.length > RATE_CAP) times.splice(0, times.length - RATE_CAP);
    this.#times.set(key, times);
  }

  rate(key: string, now: number): number {
    const times = this.#times.get(key);
    if (!times) return 0;
    const since = now - WINDOW;
    const kept = times.filter((at) => at > since && at <= now);
    if (kept.length === 0) {
      this.#times.delete(key);
      return 0;
    }
    if (kept.length !== times.length) this.#times.set(key, kept);
    return kept.length;
  }

  delete(key: string): void {
    this.#times.delete(key);
  }
}

interface Hold extends Held {
  guildId: string;
  channelId: string;
}

type Ctx = ModuleContext<typeof automodConfig>;

function keyOf(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

export class AdaptiveSlowmode {
  readonly #rates = new RateCounter();
  readonly #held = new Map<string, Hold>();
  readonly #checked = new Map<string, number>();
  readonly #busy = new Set<string>();
  #timer: NodeJS.Timeout | null = null;
  #loaded = false;

  constructor(
    private readonly ctx: Ctx,
    private readonly store: SlowmodeStore,
  ) {}

  get held(): number {
    return this.#held.size;
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    for (const hold of await this.store.all()) {
      this.#held.set(keyOf(hold.guildId, hold.channelId), {
        guildId: hold.guildId,
        channelId: hold.channelId,
        original: hold.original,
        applied: hold.applied,
        changedAt: new Date(hold.changedAt).getTime(),
      });
    }
    this.#loaded = true;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.tick(), TICK);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  observe(guildId: string, channelId: string, config: AutomodConfig, at = Date.now()): void {
    const settings = config.slowmode;
    if (!this.#loaded || !settings.enabled || !settings.channelIds.includes(channelId)) return;
    const key = keyOf(guildId, channelId);
    this.#rates.add(key, at);
    const last = this.#checked.get(key) ?? 0;
    if (at - last < CHECK_EVERY) return;
    this.#checked.delete(key);
    evict(this.#checked, MAX_CHANNELS);
    this.#checked.set(key, at);
    void this.#evaluate(guildId, channelId, config, at).catch((error) =>
      this.ctx.services.log.warn({ err: error, guild: guildId }, 'adaptive slowmode failed'),
    );
  }

  async tick(now = Date.now()): Promise<void> {
    for (const hold of [...this.#held.values()]) {
      await inGuild(hold.guildId, async () => {
        const config = await this.ctx.config(hold.guildId);
        const active =
          config.slowmode.enabled &&
          config.slowmode.channelIds.includes(hold.channelId) &&
          (await this.ctx.enabled(hold.guildId));
        if (active) {
          await this.#evaluate(hold.guildId, hold.channelId, config, now);
        } else {
          await this.#guarded(keyOf(hold.guildId, hold.channelId), () =>
            this.#restore(hold, config.logChannelId),
          );
        }
      }).catch((error) =>
        this.ctx.services.log.warn({ err: error, guild: hold.guildId }, 'adaptive slowmode failed'),
      );
    }
  }

  async onChannelUpdate(change: ChannelChange): Promise<void> {
    const key = keyOf(change.guildId, change.channel.id);
    const hold = this.#held.get(key);
    if (!hold || this.#busy.has(key)) return;
    if (change.channel.rateLimitPerUser === hold.applied) return;
    await this.#forget(hold);
  }

  async onChannelDelete(change: ChannelChange): Promise<void> {
    const hold = this.#held.get(keyOf(change.guildId, change.channel.id));
    this.#rates.delete(keyOf(change.guildId, change.channel.id));
    if (hold) await this.#forget(hold);
  }

  async #guarded(key: string, work: () => Promise<void>): Promise<void> {
    if (this.#busy.has(key)) return;
    this.#busy.add(key);
    try {
      await work();
    } finally {
      this.#busy.delete(key);
    }
  }

  async #evaluate(
    guildId: string,
    channelId: string,
    config: AutomodConfig,
    now: number,
  ): Promise<void> {
    const key = keyOf(guildId, channelId);
    const settings = config.slowmode;
    await this.#guarded(key, async () => {
      const hold = this.#held.get(key) ?? null;
      const rate = this.#rates.rate(key, now);
      if (!hold && rate <= settings.maxPerMinute) return;
      if (hold) {
        const planned = nextSlowmode({ rate, current: hold.applied, held: hold, settings, now });
        if (planned.kind === 'none') return;
      }
      const channel = await this.#channel(guildId, channelId);
      if (!channel || (hold && channel.rateLimitPerUser !== hold.applied)) {
        if (hold) await this.#forget(hold);
        return;
      }
      const current = channel.rateLimitPerUser;
      const step = nextSlowmode({ rate, current, held: hold, settings, now });
      if (step.kind === 'none') return;
      if (step.kind === 'restore' && hold) {
        await this.#restore(hold, config.logChannelId);
        return;
      }
      const where = mention.channel(channelId);
      const duration = formatDuration(step.seconds * 1_000);
      await this.#set(
        {
          guildId,
          channelId,
          original: hold?.original ?? current,
          applied: step.seconds,
          changedAt: now,
        },
        step.kind === 'raise'
          ? copy.slowmode.raised(where, duration, rate)
          : copy.slowmode.lowered(where, duration),
        config.logChannelId,
      );
    });
  }

  async #channel(guildId: string, channelId: string): Promise<ChannelRef | null> {
    const channels = await this.ctx.services.platform.channels(guildId).catch(() => []);
    return channels.find((channel) => channel.id === channelId) ?? null;
  }

  async #set(next: Hold, line: string, logChannelId: string | null): Promise<void> {
    const key = keyOf(next.guildId, next.channelId);
    const previous = this.#held.get(key);
    this.#held.set(key, next);
    try {
      await this.ctx.services.platform.editChannel(
        next.channelId,
        { rateLimitPerUser: next.applied },
        audit.slowmodeReason,
      );
    } catch (error) {
      if (previous) this.#held.set(key, previous);
      else this.#held.delete(key);
      throw error;
    }
    await this.store.save({ ...next, changedAt: new Date(next.changedAt) });
    await this.#log(logChannelId, line);
  }

  async #restore(hold: Hold, logChannelId: string | null): Promise<void> {
    const channel = await this.#channel(hold.guildId, hold.channelId);
    if (channel && channel.rateLimitPerUser === hold.applied) {
      await this.ctx.services.platform.editChannel(
        hold.channelId,
        { rateLimitPerUser: hold.original },
        audit.slowmodeReason,
      );
      await this.#log(
        logChannelId,
        copy.slowmode.restored(
          mention.channel(hold.channelId),
          hold.original > 0 ? formatDuration(hold.original * 1_000) : null,
        ),
      );
    }
    await this.#forget(hold);
  }

  async #forget(hold: Hold): Promise<void> {
    this.#held.delete(keyOf(hold.guildId, hold.channelId));
    await this.store.remove(hold.guildId, hold.channelId);
  }

  async #log(channelId: string | null, line: string): Promise<void> {
    if (!channelId) return;
    await this.ctx.services.platform
      .send(channelId, { content: line, silent: true })
      .catch((error) => this.ctx.services.log.warn({ err: error }, 'automod log channel unusable'));
  }
}
