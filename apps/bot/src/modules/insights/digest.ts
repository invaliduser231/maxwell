import { generalConfig } from '@maxwell/core/modules/general';
import type { InsightsConfig, insightsConfig } from '@maxwell/core/modules/insights';
import type { InboxStore } from '@maxwell/core/stores/inbox';
import {
  type DigestNumbers,
  type InsightsStore,
  type Range,
  safeTimezone,
} from '@maxwell/core/stores/insights';
import { type DigestTotals, renderDigest } from '../../cards/digest.js';
import { inGuild } from '../../i18n/language.js';
import type { ModuleContext } from '../../runtime/module.js';

type Ctx = ModuleContext<typeof insightsConfig>;

const DAY = 86_400_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface LocalClock {
  day: string;
  weekday: number;
  hour: number;
}

export function localClock(now: Date, timezone: string): LocalClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    weekday: WEEKDAYS.indexOf(part('weekday')),
    hour: Number(part('hour')) % 24,
  };
}

export function isoWeek(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3);
  const year = date.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 4));
  const week =
    1 +
    Math.round(((date.getTime() - first.getTime()) / DAY - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function dueWeek(
  config: Pick<InsightsConfig, 'digestChannelId' | 'digestDay' | 'digestHour'>,
  now: Date,
  timezone: string,
): string | null {
  if (!config.digestChannelId) return null;
  const clock = localClock(now, timezone);
  if (clock.weekday !== config.digestDay || clock.hour < config.digestHour) return null;
  return isoWeek(clock.day);
}

export function digestRanges(now: Date): { current: Range; previous: Range } {
  const to = Math.floor(now.getTime() / DAY) * DAY;
  return {
    current: { from: new Date(to - 7 * DAY), to: new Date(to) },
    previous: { from: new Date(to - 14 * DAY), to: new Date(to - 7 * DAY) },
  };
}

export function totals(numbers: DigestNumbers): DigestTotals {
  return {
    joins: numbers.joins,
    leaves: numbers.leaves,
    messages: numbers.messages,
    active: numbers.activeMembers,
    moderation: { ...numbers.moderation },
  };
}

export function counted(numbers: DigestNumbers): boolean {
  return (
    numbers.messages + numbers.joins + numbers.leaves + numbers.activeMembers > 0 ||
    Object.values(numbers.moderation).some((count) => count > 0)
  );
}

export class WeeklyDigest {
  constructor(
    private readonly ctx: Ctx,
    private readonly store: InsightsStore,
    private readonly inbox: InboxStore,
    private readonly flush: () => Promise<unknown>,
  ) {}

  async render(guildId: string, now = new Date()): Promise<Buffer> {
    const { platform, cards } = this.ctx.services;
    const { current, previous } = digestRanges(now);
    await this.flush();
    const [numbers, before, open, guild, channels, style] = await Promise.all([
      this.store.digest(guildId, current),
      this.store.digest(guildId, previous),
      this.inbox.counts(guildId),
      platform.guild(guildId),
      platform.channels(guildId).catch(() => []),
      cards.forGuild(guildId),
    ]);
    const names = new Map(channels.map((channel) => [channel.id, channel.name]));
    return renderDigest({
      community: guild?.name ?? guildId,
      from: current.from,
      to: current.to,
      current: totals(numbers),
      previous: counted(before) ? totals(before) : null,
      inbox: open.open + open.claimed,
      channels: numbers.channels.map((channel) => ({
        name: names.get(channel.channelId) ?? null,
        count: channel.count,
      })),
      style,
    });
  }

  async post(guildId: string, channelId: string, now = new Date()): Promise<boolean> {
    const { platform, log } = this.ctx.services;
    if (!(await platform.channelInGuild(guildId, channelId).catch(() => false))) {
      log.info({ guild: guildId, channel: channelId }, 'digest channel not in the community');
      return false;
    }
    const missing = await platform
      .missingBotPermissions(guildId, channelId, ['ViewChannel', 'SendMessages', 'AttachFiles'])
      .catch(() => ['SendMessages']);
    if (missing.length > 0) {
      log.info({ guild: guildId, channel: channelId, missing }, 'digest channel not usable');
      return false;
    }
    const image = await this.render(guildId, now);
    await platform.send(channelId, {
      files: [{ name: 'weekly-digest.png', data: image }],
      silent: true,
    });
    return true;
  }

  async test(guildId: string): Promise<boolean> {
    const config = await this.ctx.config(guildId);
    if (!config.digestChannelId) {
      this.ctx.services.log.info({ guild: guildId }, 'digest test without a channel');
      return false;
    }
    return this.post(guildId, config.digestChannelId);
  }

  async tick(now = new Date()): Promise<number> {
    const { settings, log } = this.ctx.services;
    let posted = 0;
    for (const guildId of await this.store.digestGuilds()) {
      let claimed: string | null = null;
      try {
        await inGuild(guildId, async () => {
          const [config, general] = await Promise.all([
            this.ctx.config(guildId),
            settings.config(guildId, 'general', generalConfig),
          ]);
          const week = dueWeek(config, now, general.timezone);
          const channelId = config.digestChannelId;
          if (!week || !channelId) return;
          if (!(await this.store.claimDigest(guildId, week, channelId))) return;
          claimed = week;
          if (await this.post(guildId, channelId, now)) {
            posted += 1;
            claimed = null;
          }
        });
      } catch (error) {
        log.warn({ err: error, guild: guildId }, 'weekly digest failed');
      }
      if (claimed) await this.store.releaseDigest(guildId, claimed).catch(() => {});
    }
    return posted;
  }
}
