export interface Target {
  kind: 'event' | 'poll';
  id: string;
}

export class TargetCache {
  readonly #entries = new Map<string, Target | null>();

  constructor(private readonly limit = 10_000) {}

  get size(): number {
    return this.#entries.size;
  }

  has(messageId: string): boolean {
    return this.#entries.has(messageId);
  }

  get(messageId: string): Target | null | undefined {
    const hit = this.#entries.get(messageId);
    if (hit === undefined) return undefined;
    this.#entries.delete(messageId);
    this.#entries.set(messageId, hit);
    return hit;
  }

  set(messageId: string, target: Target | null): void {
    this.#entries.delete(messageId);
    this.#entries.set(messageId, target);
    while (this.#entries.size > this.limit) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  forget(messageId: string): void {
    this.#entries.delete(messageId);
  }
}
