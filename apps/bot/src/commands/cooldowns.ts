export class Cooldowns {
  readonly #until = new Map<string, number>();
  #lastSweep = 0;

  constructor(private readonly now: () => number = Date.now) {}

  take(key: string, ms: number): number {
    const now = this.now();
    this.#sweep(now);
    const until = this.#until.get(key) ?? 0;
    if (until > now) return until - now;
    this.#until.set(key, now + ms);
    return 0;
  }

  #sweep(now: number): void {
    if (now - this.#lastSweep < 60_000) return;
    this.#lastSweep = now;
    for (const [key, until] of this.#until) {
      if (until <= now) this.#until.delete(key);
    }
  }
}
