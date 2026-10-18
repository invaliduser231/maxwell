import { type GameKey, type GamesConfig, gamesConfig } from '@maxwell/core/modules/games';
import { GamesStore } from '@maxwell/core/stores/games';
import type { GuildContext } from '../../commands/types.js';
import type { Services } from '../../services.js';
import { type Currency, money, type Wallets } from '../economy/wallets.js';
import { copy } from './copy.js';

export const MODULE = 'games';
const USAGE = 15_000;

export type StakeCheck = { ok: true; currency: Currency } | { ok: false };

export class Games {
  readonly store: GamesStore;

  constructor(
    readonly services: Services,
    readonly wallets: Wallets,
  ) {
    this.store = new GamesStore(services.sql);
  }

  config(guildId: string): Promise<GamesConfig> {
    return this.services.settings.config(guildId, MODULE, gamesConfig);
  }

  async currency(guildId: string): Promise<Currency | null> {
    if (!(await this.wallets.active(guildId))) return null;
    return (await this.wallets.config(guildId)).currency;
  }

  async reward(guildId: string, userId: string, game: GameKey): Promise<string | null> {
    const credited = await this.wallets.gameReward(guildId, userId, game);
    if (credited <= 0) return null;
    const currency = await this.currency(guildId);
    return currency ? copy.reward(money(credited, currency)) : null;
  }

  async checkStake(
    ctx: GuildContext,
    stake: number,
    userIds: readonly string[],
  ): Promise<StakeCheck> {
    const noise = async (content: string): Promise<StakeCheck> => {
      await ctx.reply({ content, deleteAfter: USAGE });
      return { ok: false };
    };
    const currency = await this.currency(ctx.guildId);
    if (!currency) return noise(copy.economyOff);
    const config = await this.config(ctx.guildId);
    const min = Math.min(config.stakes.min, config.stakes.max);
    const max = Math.max(config.stakes.min, config.stakes.max);
    if (stake < min || stake > max) {
      return noise(copy.stakeRange(money(min, currency), money(max, currency)));
    }
    for (const userId of userIds) {
      const balance = await this.wallets.store.balance(ctx.guildId, userId);
      if (balance < stake) {
        if (userId === ctx.message.author.id) return noise(copy.broke(money(balance, currency)));
        return noise(copy.coinflip.failed);
      }
    }
    return { ok: true, currency };
  }

  async allowed(ctx: GuildContext, enabled: boolean, name: string): Promise<boolean> {
    if (!enabled) {
      await ctx.reply({ content: copy.off(name), deleteAfter: USAGE });
      return false;
    }
    const config = await this.config(ctx.guildId);
    if (config.channelIds.length > 0 && !config.channelIds.includes(ctx.message.channelId)) {
      await ctx.reply({ content: copy.wrongChannel, deleteAfter: 8_000 });
      return false;
    }
    return true;
  }
}
