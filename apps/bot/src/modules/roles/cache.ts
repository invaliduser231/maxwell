export class Recent<V> {
  readonly #entries = new Map<string, { value: V; at: number }>();

  constructor(
    private readonly limit: number,
    private readonly ttl: number,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.#entries.size;
  }

  get(key: string): V | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.at >= this.ttl) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  set(key: string, value: V): void {
    this.#entries.delete(key);
    this.#entries.set(key, { value, at: this.now() });
    while (this.#entries.size > this.limit) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.#entries.delete(key);
  }

  deleteWhere(match: (key: string) => boolean): void {
    for (const key of [...this.#entries.keys()]) if (match(key)) this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }
}
