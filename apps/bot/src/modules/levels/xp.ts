import { randomInt } from 'node:crypto';
import type { LevelsConfig } from '@maxwell/core/modules/levels';

export type Random = (min: number, max: number) => number;

export const secureRandom: Random = (min, max) => randomInt(min, max + 1);

export function earns(config: LevelsConfig, channelId: string, roles: readonly string[]): boolean {
  if (config.excludedChannels.includes(channelId)) return false;
  return !roles.some((role) => config.excludedRoles.includes(role));
}

export function multiplier(
  config: LevelsConfig,
  channelId: string,
  roles: readonly string[],
): number {
  const channel = config.channelMultipliers.find((entry) => entry.channelId === channelId);
  const held = config.roleMultipliers.filter((entry) => roles.includes(entry.roleId));
  const role = held.length > 0 ? Math.max(...held.map((entry) => entry.multiplier)) : 1;
  return (channel?.multiplier ?? 1) * role;
}

export function rollXp(
  config: LevelsConfig,
  channelId: string,
  roles: readonly string[],
  random: Random = secureRandom,
): number {
  const low = Math.min(config.xpMin, config.xpMax);
  const high = Math.max(config.xpMin, config.xpMax);
  const base = high > low ? random(low, high) : low;
  return Math.round(base * multiplier(config, channelId, roles));
}

export interface RewardPlan {
  add: string[];
  remove: string[];
}

export function planRewards(
  rewards: LevelsConfig['rewards'],
  level: number,
  removePrevious: boolean,
  current: readonly string[],
  strict = false,
): RewardPlan {
  const reached = rewards.filter((reward) => reward.level <= level);
  const top = reached.reduce((max, reward) => Math.max(max, reward.level), 0);
  const wanted = new Set(
    (removePrevious ? reached.filter((reward) => reward.level === top) : reached).map(
      (reward) => reward.roleId,
    ),
  );
  const outdated = new Set(
    rewards
      .filter((reward) => !wanted.has(reward.roleId))
      .filter((reward) => strict || (removePrevious && reward.level < top))
      .map((reward) => reward.roleId),
  );
  return {
    add: [...wanted].filter((role) => !current.includes(role)),
    remove: [...outdated].filter((role) => current.includes(role)),
  };
}

export function newRewards(
  rewards: LevelsConfig['rewards'],
  from: number,
  to: number,
): LevelsConfig['rewards'] {
  return rewards
    .filter((reward) => reward.level > from && reward.level <= to)
    .sort((a, b) => b.level - a.level);
}

export interface TemplateValues {
  user: string;
  name: string;
  level: number;
  role: string;
  server: string;
}

export function renderTemplate(template: string, values: TemplateValues): string {
  return template.replace(/\{(user|name|level|role|server)\}/g, (_, key: keyof TemplateValues) =>
    String(values[key]),
  );
}

export class CooldownMap {
  readonly #until = new Map<string, number>();

  constructor(private readonly limit = 50_000) {}

  ready(key: string, now = Date.now()): boolean {
    const until = this.#until.get(key);
    return until === undefined || until <= now;
  }

  hold(key: string, ms: number, now = Date.now()): void {
    if (ms <= 0) return;
    this.#until.delete(key);
    this.#until.set(key, now + ms);
    if (this.#until.size > this.limit) this.#prune(now);
  }

  get size(): number {
    return this.#until.size;
  }

  #prune(now: number): void {
    for (const [key, until] of this.#until) {
      if (until <= now) this.#until.delete(key);
    }
    while (this.#until.size > this.limit) {
      const oldest = this.#until.keys().next().value;
      if (oldest === undefined) break;
      this.#until.delete(oldest);
    }
  }
}
