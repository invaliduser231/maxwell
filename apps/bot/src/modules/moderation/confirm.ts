import type { ReactionEvent } from '../../platform/types.js';

interface Pending {
  userId: string;
  emoji: string;
  resolve(ok: boolean): void;
  timer: NodeJS.Timeout;
}

export class Confirmations {
  readonly #pending = new Map<string, Pending>();

  constructor(private readonly max = 200) {}

  wait(messageId: string, userId: string, emoji: string, timeoutMs = 30_000): Promise<boolean> {
    if (this.#pending.size >= this.max) {
      const oldest = this.#pending.keys().next().value;
      if (oldest !== undefined) this.#settle(oldest, false);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.#settle(messageId, false), timeoutMs);
      timer.unref();
      this.#pending.set(messageId, { userId, emoji, resolve, timer });
    });
  }

  handle(reaction: ReactionEvent): boolean {
    const entry = this.#pending.get(reaction.messageId);
    if (!entry || entry.userId !== reaction.userId || entry.emoji !== reaction.emoji) return false;
    this.#settle(reaction.messageId, true);
    return true;
  }

  stop(): void {
    for (const id of [...this.#pending.keys()]) this.#settle(id, false);
  }

  #settle(messageId: string, ok: boolean): void {
    const entry = this.#pending.get(messageId);
    if (!entry) return;
    this.#pending.delete(messageId);
    clearTimeout(entry.timer);
    entry.resolve(ok);
  }
}
