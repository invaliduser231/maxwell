import type { AuditLogEvent } from '../../platform/types.js';

type Waiter = (entry: AuditLogEvent | null) => void;

export class AuditTrail {
  readonly #entries = new Map<string, { entry: AuditLogEvent; at: number }>();
  readonly #waiters = new Map<string, Set<Waiter>>();

  constructor(
    private readonly ttlMs = 15_000,
    private readonly max = 2_000,
  ) {}

  #key(guildId: string, action: number, targetId: string): string {
    return `${guildId}:${action}:${targetId}`;
  }

  add(entry: AuditLogEvent, now = Date.now()): void {
    if (!entry.targetId) return;
    const key = this.#key(entry.guildId, entry.action, entry.targetId);
    const waiters = this.#waiters.get(key);
    if (waiters && waiters.size > 0) {
      this.#waiters.delete(key);
      for (const waiter of waiters) waiter(entry);
      return;
    }
    this.#entries.delete(key);
    this.#entries.set(key, { entry, at: now });
    while (this.#entries.size > this.max) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  take(guildId: string, action: number, targetId: string, now = Date.now()): AuditLogEvent | null {
    const key = this.#key(guildId, action, targetId);
    const hit = this.#entries.get(key);
    if (!hit) return null;
    this.#entries.delete(key);
    return now - hit.at <= this.ttlMs ? hit.entry : null;
  }

  wait(
    guildId: string,
    action: number,
    targetId: string,
    timeoutMs: number,
  ): Promise<AuditLogEvent | null> {
    const hit = this.take(guildId, action, targetId);
    if (hit || timeoutMs <= 0) return Promise.resolve(hit);
    const key = this.#key(guildId, action, targetId);
    return new Promise((resolve) => {
      const set = this.#waiters.get(key) ?? new Set<Waiter>();
      this.#waiters.set(key, set);
      const timer = setTimeout(() => {
        set.delete(waiter);
        if (set.size === 0 && this.#waiters.get(key) === set) this.#waiters.delete(key);
        resolve(null);
      }, timeoutMs);
      timer.unref?.();
      const waiter: Waiter = (entry) => {
        clearTimeout(timer);
        resolve(entry);
      };
      set.add(waiter);
    });
  }

  stop(): void {
    for (const set of this.#waiters.values()) for (const waiter of set) waiter(null);
    this.#waiters.clear();
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}
