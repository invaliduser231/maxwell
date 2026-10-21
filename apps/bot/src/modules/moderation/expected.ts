export class ExpectedActions {
  readonly #entries = new Map<string, number>();

  constructor(
    private readonly ttlMs = 60_000,
    private readonly max = 2_000,
  ) {}

  #key(guildId: string, userId: string, kind: string): string {
    return `${guildId}:${userId}:${kind}`;
  }

  expect(guildId: string, userId: string, kind: string, now = Date.now()): void {
    const key = this.#key(guildId, userId, kind);
    this.#entries.delete(key);
    this.#entries.set(key, now + this.ttlMs);
    while (this.#entries.size > this.max) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  take(guildId: string, userId: string, kind: string, now = Date.now()): boolean {
    const key = this.#key(guildId, userId, kind);
    const until = this.#entries.get(key);
    if (until === undefined) return false;
    this.#entries.delete(key);
    return until >= now;
  }

  get size(): number {
    return this.#entries.size;
  }
}

export class BoundedMap<K, V> {
  readonly #map = new Map<K, V>();

  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const value = this.#map.get(key);
    if (value !== undefined) {
      this.#map.delete(key);
      this.#map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    this.#map.delete(key);
    this.#map.set(key, value);
    while (this.#map.size > this.max) {
      const oldest = this.#map.keys().next().value;
      if (oldest === undefined) break;
      this.#map.delete(oldest);
    }
  }

  delete(key: K): boolean {
    return this.#map.delete(key);
  }

  get size(): number {
    return this.#map.size;
  }
}

export interface Attribution {
  actorId: string | null;
  reason: string | null;
}

export class AuditHolds {
  readonly #entries: BoundedMap<string, Attribution & { until: number }>;

  constructor(
    private readonly ttlMs = 30_000,
    max = 2_000,
  ) {
    this.#entries = new BoundedMap(max);
  }

  #key(guildId: string, userId: string, kind: string): string {
    return `${guildId}:${userId}:${kind}`;
  }

  hold(guildId: string, userId: string, kind: string, entry: Attribution, now = Date.now()): void {
    this.#entries.set(this.#key(guildId, userId, kind), { ...entry, until: now + this.ttlMs });
  }

  take(guildId: string, userId: string, kind: string, now = Date.now()): Attribution | null {
    const key = this.#key(guildId, userId, kind);
    const entry = this.#entries.get(key);
    if (!entry) return null;
    this.#entries.delete(key);
    if (entry.until < now) return null;
    return { actorId: entry.actorId, reason: entry.reason };
  }

  get size(): number {
    return this.#entries.size;
  }
}
