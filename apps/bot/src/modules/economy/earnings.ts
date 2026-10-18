import type { IncomingMessage } from '../../platform/types.js';
import type { Services } from '../../services.js';
import type { Wallets } from './wallets.js';

export function rollAmount(min: number, max: number, random = Math.random): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low + Math.floor(random() * (high - low + 1));
}

export class Throttle {
  readonly #last = new Map<string, number>();

  constructor(
    private readonly limit = 50_000,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string, ms: number): boolean {
    const now = this.now();
    const last = this.#last.get(key);
    if (last !== undefined && now - last < ms) return false;
    this.#last.delete(key);
    this.#last.set(key, now);
    if (this.#last.size > this.limit) {
      const oldest = this.#last.keys().next().value;
      if (oldest !== undefined) this.#last.delete(oldest);
    }
    return true;
  }

  get size(): number {
    return this.#last.size;
  }
}

export class Earnings {
  readonly #throttle = new Throttle();

  constructor(
    private readonly services: Services,
    private readonly wallets: Wallets,
  ) {}

  async onMessage(message: IncomingMessage): Promise<void> {
    const guildId = message.guildId;
    if (!guildId || message.author.bot || message.fromWebhook) return;
    const config = await this.wallets.config(guildId);
    const rules = config.message;
    if (!rules.enabled || rules.ignoredChannels.includes(message.channelId)) return;
    const prefix = await this.services.guilds.prefix(guildId);
    if (message.content.toLowerCase().startsWith(prefix.toLowerCase())) return;
    if (!this.#throttle.take(`${guildId}:${message.author.id}`, rules.cooldownSeconds * 1000))
      return;
    const amount = rollAmount(rules.min, rules.max);
    if (amount <= 0) return;
    await this.wallets.ensure(guildId, message.author.id, config);
    await this.wallets.store.earn(guildId, message.author.id, amount, 'message', config.dailyCap);
  }
}
