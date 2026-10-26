import { type Actor, cancel, maxwell } from '@maxwell/core';
import type { RaidSettings } from '@maxwell/core/modules/security';
import type { AutomodStore } from '@maxwell/core/stores/automod';
import type { RaidState, SecurityRaid, SecurityStore } from '@maxwell/core/stores/security';
import type { IncomingMessage, MemberJoin } from '../../platform/types.js';
import { lines, snowflakeDate, timestamp } from '../../ui/format.js';
import { audit, copy, reasons } from './copy.js';
import type { Ctx, Guard } from './guard.js';
import { JoinLog, type JoinSample, waveAround } from './risk.js';

export type RaidTrigger =
  | { kind: 'joins'; joins: number; seconds: number }
  | { kind: 'wave'; size: number }
  | { kind: 'flood'; members: number }
  | { kind: 'manual'; userId: string | null }
  | { kind: 'nuke' };

const ACTIVE_TTL = 10_000;
const GUILD_CAP = 10_000;
const MENTION_FLOOD = 5;

export function endKey(raidId: string): string {
  return `security.raid.end:${raidId}`;
}

export function floodKey(content: string, mentions: number): string | null {
  if (mentions >= MENTION_FLOOD) return '@mentions';
  const key = content
    .toLowerCase()
    .replace(/<@[!&]?\d+>/g, '@')
    .replace(/https?:\/\/\S+/g, (url) => url.replace(/[?#].*$/, ''))
    .replace(/\s+/g, ' ')
    .trim();
  return key.length >= 6 ? key.slice(0, 300) : null;
}

export class FloodWatch {
  readonly #guilds = new Map<string, Map<string, Map<string, number>>>();

  add(guildId: string, key: string, userId: string, at: number, seconds: number): string[] {
    let buckets = this.#guilds.get(guildId);
    if (!buckets) {
      while (this.#guilds.size >= GUILD_CAP) {
        const oldest = this.#guilds.keys().next().value;
        if (oldest === undefined) break;
        this.#guilds.delete(oldest);
      }
      buckets = new Map();
      this.#guilds.set(guildId, buckets);
    }
    const since = at - seconds * 1000;
    for (const [bucketKey, users] of buckets) {
      for (const [user, seen] of users) if (seen <= since) users.delete(user);
      if (users.size === 0) buckets.delete(bucketKey);
    }
    const users = buckets.get(key) ?? new Map<string, number>();
    users.set(userId, at);
    buckets.set(key, users);
    return [...users.keys()];
  }

  clear(guildId: string): void {
    this.#guilds.delete(guildId);
  }
}

export class Newcomers {
  readonly #guilds = new Map<string, Map<string, number>>();

  add(guildId: string, userId: string, at: number): void {
    let users = this.#guilds.get(guildId);
    if (!users) {
      while (this.#guilds.size >= GUILD_CAP) {
        const oldest = this.#guilds.keys().next().value;
        if (oldest === undefined) break;
        this.#guilds.delete(oldest);
      }
      users = new Map();
      this.#guilds.set(guildId, users);
    }
    users.set(userId, at);
    if (users.size > 5_000) {
      const first = users.keys().next().value;
      if (first !== undefined) users.delete(first);
    }
  }

  joinedWithin(guildId: string, userId: string, ms: number, now: number): boolean {
    const at = this.#guilds.get(guildId)?.get(userId);
    return at !== undefined && now - at <= ms;
  }
}

export interface RaidHooks {
  recheck(guildId: string, userIds: readonly string[]): Promise<void>;
}

export class RaidWatch {
  readonly joins = new JoinLog();
  readonly flood = new FloodWatch();
  readonly newcomers = new Newcomers();
  readonly #active = new Map<
    string,
    { raid: SecurityRaid | null; lockdown: boolean; at: number }
  >();
  hooks: RaidHooks = { recheck: async () => {} };

  constructor(
    private readonly ctx: Ctx,
    private readonly store: SecurityStore,
    private readonly automod: AutomodStore,
    private readonly guard: Guard,
    private readonly now: () => number = Date.now,
  ) {}

  async active(guildId: string): Promise<boolean> {
    const cached = this.#active.get(guildId);
    if (cached && this.now() - cached.at < ACTIVE_TTL)
      return cached.raid !== null || cached.lockdown;
    const [raid, incident] = await Promise.all([
      this.store.activeRaid(guildId),
      this.automod.activeIncident(guildId).catch(() => null),
    ]);
    const live = raid?.endsAt && raid.endsAt.getTime() <= this.now() ? null : raid;
    this.#remember(guildId, live, incident !== null);
    return live !== null || incident !== null;
  }

  #remember(guildId: string, raid: SecurityRaid | null, lockdown = false): void {
    this.#active.delete(guildId);
    while (this.#active.size >= GUILD_CAP) {
      const oldest = this.#active.keys().next().value;
      if (oldest === undefined) break;
      this.#active.delete(oldest);
    }
    this.#active.set(guildId, { raid, lockdown, at: this.now() });
  }

  async onJoin(join: MemberJoin): Promise<void> {
    if (join.user.bot) return;
    const at = this.now();
    this.newcomers.add(join.guildId, join.user.id, at);
    const config = await this.ctx.config(join.guildId);
    const raid = config.raid;
    const sample: JoinSample = {
      userId: join.user.id,
      at,
      createdAt: snowflakeDate(join.user.id).getTime(),
      name: join.user.username,
      hasAvatar: join.user.hasAvatar ?? true,
    };
    const keep = Math.max(raid.perSeconds, raid.waveSeconds) * 1000;
    const recent = this.joins.add(join.guildId, sample, keep);
    if (!raid.enabled) return;

    if (await this.active(join.guildId)) {
      await this.extend(join.guildId, raid);
      return;
    }

    const burst = recent.filter((entry) => entry.at > at - raid.perSeconds * 1000);
    if (burst.length >= raid.joins) {
      await this.start(
        join.guildId,
        { kind: 'joins', joins: burst.length, seconds: raid.perSeconds },
        maxwell,
      );
      await this.hooks.recheck(
        join.guildId,
        burst.map((entry) => entry.userId),
      );
      return;
    }

    const windowed = recent.filter((entry) => entry.at > at - raid.waveSeconds * 1000);
    const wave = waveAround(windowed.slice(0, -1), sample);
    if (wave.length >= raid.waveSize) {
      await this.start(join.guildId, { kind: 'wave', size: wave.length }, maxwell);
      await this.hooks.recheck(
        join.guildId,
        wave.map((entry) => entry.userId),
      );
    }
  }

  async onMessage(message: IncomingMessage): Promise<void> {
    const guildId = message.guildId;
    if (!guildId || message.author.bot || message.fromWebhook) return;
    const config = await this.ctx.config(guildId);
    const raid = config.raid;
    if (!raid.enabled) return;
    const at = this.now();
    if (
      !this.newcomers.joinedWithin(guildId, message.author.id, raid.newMemberMinutes * 60_000, at)
    ) {
      return;
    }
    const mentions = new Set([...message.mentionUsers, ...message.mentionRoles]).size;
    const key = floodKey(message.content, mentions + (message.mentionEveryone ? MENTION_FLOOD : 0));
    if (!key) return;
    const users = this.flood.add(guildId, key, message.author.id, at, raid.floodSeconds);
    if (users.length < raid.floodMembers) return;
    if (!(await this.active(guildId))) {
      await this.start(guildId, { kind: 'flood', members: users.length }, maxwell);
    } else {
      await this.extend(guildId, raid);
    }
    await this.hooks.recheck(guildId, users);
  }

  async start(guildId: string, trigger: RaidTrigger, by: Actor): Promise<SecurityRaid> {
    const config = await this.ctx.config(guildId);
    const settings = config.raid;
    const endsAt = new Date(this.now() + settings.minutes * 60_000);
    const { raid, created } = await this.store.startRaid(guildId, trigger.kind, by.id, endsAt);
    this.#remember(guildId, raid);
    await cancel(this.ctx.services.sql, endKey(raid.id)).catch(() => false);
    await this.ctx.schedule('raid.end', {
      guildId,
      payload: { raidId: raid.id },
      runAt: raid.endsAt ?? endsAt,
      dedupeKey: endKey(raid.id),
    });
    if (!created) return raid;

    const state = await this.#apply(guildId, settings);
    await this.store.setRaidState(raid.id, state);
    await this.store.event({
      guildId,
      kind: 'raid',
      userId: null,
      actorId: by.id,
      summary: `started (${trigger.kind})`,
      detail: { ...trigger, raidId: raid.id },
    });
    await this.ctx.record(guildId, by, 'raid.start', audit.raidStarted(trigger.kind), {
      after: { raidId: raid.id, endsAt: endsAt.toISOString() },
      undo: { kind: 'raid', payload: { raidId: raid.id } },
    });
    await this.guard.post(guildId, config, {
      ping: true,
      content: lines(
        this.#headline(trigger),
        copy.raid.effects(
          timestamp(raid.endsAt ?? endsAt, 'R'),
          state.pausedInvites === true,
          (state.slowmode?.length ?? 0) > 0 ? settings.slowmodeSeconds : 0,
        ),
      ),
    });
    return { ...raid, state };
  }

  #headline(trigger: RaidTrigger): string {
    switch (trigger.kind) {
      case 'joins':
        return copy.raid.started.joins(trigger.joins, trigger.seconds);
      case 'wave':
        return copy.raid.started.wave(trigger.size);
      case 'flood':
        return copy.raid.started.flood(trigger.members);
      case 'manual':
        return copy.raid.started.manual(trigger.userId);
      case 'nuke':
        return copy.raid.started.nuke;
    }
  }

  async #apply(guildId: string, settings: RaidSettings): Promise<RaidState> {
    const { platform, log } = this.ctx.services;
    const state: RaidState = {};
    if (settings.pauseInvites) {
      try {
        state.pausedInvites = await platform.setInvitesPaused(guildId, true, reasons.raidInvites);
      } catch (error) {
        log.warn({ err: error, guild: guildId }, 'raid invite pause failed');
      }
    }
    if (settings.slowmodeSeconds > 0 && settings.slowmodeChannelIds.length > 0) {
      const channels = await platform.channels(guildId).catch(() => []);
      const slowmode: NonNullable<RaidState['slowmode']> = [];
      for (const channelId of settings.slowmodeChannelIds) {
        const channel = channels.find((entry) => entry.id === channelId);
        if (!channel || channel.rateLimitPerUser >= settings.slowmodeSeconds) continue;
        try {
          await platform.editChannel(
            channelId,
            { rateLimitPerUser: settings.slowmodeSeconds },
            reasons.raidSlowmode,
          );
          slowmode.push({ channelId, before: channel.rateLimitPerUser });
        } catch (error) {
          log.warn({ err: error, guild: guildId }, 'raid slowmode failed');
        }
      }
      if (slowmode.length > 0) state.slowmode = slowmode;
    }
    return state;
  }

  async extend(guildId: string, settings: RaidSettings): Promise<void> {
    const raid = await this.store.activeRaid(guildId);
    if (!raid?.endsAt) return;
    const left = raid.endsAt.getTime() - this.now();
    if (left > (settings.minutes * 60_000) / 2) return;
    await this.start(guildId, { kind: 'manual', userId: null }, maxwell);
  }

  async end(guildId: string, by: Actor, raidId?: string | null): Promise<SecurityRaid | null> {
    const current = await this.store.activeRaid(guildId);
    if (!current || (raidId && current.id !== raidId)) return null;
    if (raidId && current.endsAt && current.endsAt.getTime() > this.now() + 1_000) {
      await this.ctx.schedule('raid.end', {
        guildId,
        payload: { raidId: current.id },
        runAt: current.endsAt,
        dedupeKey: endKey(current.id),
      });
      return null;
    }
    const ended = await this.store.endRaid(guildId, by.id);
    this.#remember(guildId, null);
    if (!ended) return null;
    await cancel(this.ctx.services.sql, endKey(ended.id)).catch(() => false);
    await this.#revert(guildId, ended.state);
    this.joins.clear(guildId);
    this.flood.clear(guildId);
    const config = await this.ctx.config(guildId);
    const counts = await this.store.counts(guildId, ended.startedAt);
    await this.store.event({
      guildId,
      kind: 'raid',
      userId: null,
      actorId: by.id,
      summary: 'ended',
      detail: { raidId: ended.id, checked: counts.flagged },
    });
    if (by.id !== null) {
      await this.ctx.record(guildId, by, 'raid.end', audit.raidEnded, {
        after: { raidId: ended.id },
      });
    }
    await this.guard.post(guildId, config, { content: copy.raid.ended(counts.flagged) });
    return ended;
  }

  async #revert(guildId: string, state: RaidState): Promise<void> {
    const { platform, log } = this.ctx.services;
    if (state.pausedInvites) {
      await platform
        .setInvitesPaused(guildId, false, reasons.raidOver)
        .catch((error) => log.warn({ err: error, guild: guildId }, 'raid invite resume failed'));
    }
    for (const entry of state.slowmode ?? []) {
      await platform
        .editChannel(entry.channelId, { rateLimitPerUser: entry.before }, reasons.raidOver)
        .catch((error) => log.warn({ err: error, guild: guildId }, 'raid slowmode reset failed'));
    }
  }

  forget(guildId: string): void {
    this.#active.delete(guildId);
  }
}
