import { type EconomyConfig, economyConfig } from '@maxwell/core/modules/economy';
import { EconomyStore } from '@maxwell/core/stores/economy';
import type { Services } from '../../services.js';
import { count } from '../../ui/format.js';

export const MODULE = 'economy';
const OPENED_LIMIT = 20_000;

export type Currency = EconomyConfig['currency'];

export function money(amount: number, currency: Currency): string {
  return `**${count(amount)}** ${Math.abs(amount) === 1 ? currency.singular : currency.name}`;
}

export function short(amount: number, currency: Currency): string {
  return `${count(amount)} ${currency.symbol}`;
}

export class Wallets {
  readonly store: EconomyStore;
  readonly #opened = new Set<string>();

  constructor(private readonly services: Services) {
    this.store = new EconomyStore(services.sql);
  }

  config(guildId: string): Promise<EconomyConfig> {
    return this.services.settings.config(guildId, MODULE, economyConfig);
  }

  active(guildId: string): Promise<boolean> {
    return this.services.settings.enabled(guildId, MODULE);
  }

  async ensure(guildId: string, userId: string, config?: EconomyConfig): Promise<void> {
    const key = `${guildId}:${userId}`;
    if (this.#opened.has(key)) return;
    const starting = (config ?? (await this.config(guildId))).startingBalance;
    await this.store.open(guildId, userId, starting);
    if (this.#opened.size >= OPENED_LIMIT) this.#opened.clear();
    this.#opened.add(key);
  }

  async reward(
    guildId: string,
    userId: string,
    amount: number,
    kind: string,
    note: string | null = null,
  ): Promise<number> {
    if (amount <= 0 || !(await this.active(guildId))) return 0;
    const config = await this.config(guildId);
    await this.ensure(guildId, userId, config);
    const { credited } = await this.store.earn(guildId, userId, amount, kind, config.dailyCap, {
      note,
    });
    return credited;
  }

  async gameReward(guildId: string, userId: string, game: string): Promise<number> {
    if (!(await this.active(guildId))) return 0;
    const config = await this.config(guildId);
    return this.reward(guildId, userId, config.rewards.gameWin, 'game', game);
  }
}
