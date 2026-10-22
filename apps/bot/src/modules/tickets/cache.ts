export class BoundedCache<K, V> {
  readonly #entries = new Map<K, { value: V; at: number }>();

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
  ) {}

  peek(key: K, now = Date.now()): { value: V } | undefined {
    const hit = this.#entries.get(key);
    if (!hit) return undefined;
    if (now - hit.at > this.ttlMs) {
      this.#entries.delete(key);
      return undefined;
    }
    return { value: hit.value };
  }

  set(key: K, value: V, now = Date.now()): void {
    this.#entries.delete(key);
    this.#entries.set(key, { value, at: now });
    while (this.#entries.size > this.max) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.#entries.delete(oldest.value);
    }
  }

  delete(key: K): void {
    this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}

export class KeyedQueue {
  readonly #tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(key, tail);
    void tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
    return result;
  }

  get size(): number {
    return this.#tails.size;
  }
}
