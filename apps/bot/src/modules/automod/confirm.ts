import type { Platform, ReactionEvent } from '../../platform/types.js';
import type { IconSet } from '../../ui/icons.js';

const WINDOW = 30_000;
const MAX_PENDING = 500;
const FALLBACK = '✅';

interface Pending {
  userId: string;
  resolve(confirmed: boolean): void;
  timer: NodeJS.Timeout;
}

export class Confirmations {
  readonly #pending = new Map<string, Pending>();
  readonly #emoji: string;

  constructor(
    private readonly platform: Platform,
    icons: IconSet,
  ) {
    this.#emoji = icons.reaction('ok') ?? FALLBACK;
  }

  get emoji(): string {
    return this.#emoji;
  }

  handle(reaction: ReactionEvent): void {
    const pending = this.#pending.get(reaction.messageId);
    if (!pending || reaction.userId !== pending.userId || reaction.emoji !== this.#emoji) return;
    this.#settle(reaction.messageId, true);
  }

  async wait(channelId: string, messageId: string, userId: string): Promise<boolean> {
    if (this.#pending.size >= MAX_PENDING) return false;
    const result = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.#settle(messageId, false), WINDOW);
      timer.unref();
      this.#pending.set(messageId, { userId, resolve, timer });
    });
    await this.platform.react(channelId, messageId, this.#emoji).catch(() => undefined);
    return result;
  }

  #settle(messageId: string, confirmed: boolean): void {
    const pending = this.#pending.get(messageId);
    if (!pending) return;
    this.#pending.delete(messageId);
    clearTimeout(pending.timer);
    pending.resolve(confirmed);
  }

  stop(): void {
    for (const messageId of [...this.#pending.keys()]) this.#settle(messageId, false);
  }
}
