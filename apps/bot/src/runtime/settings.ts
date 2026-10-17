import { CONFIG_CHANNEL, type ModuleState, type ModuleStore, type Sql } from '@maxwell/core';
import type { z } from 'zod';
import type { Logger } from '../log.js';

const TTL = 5 * 60_000;

export class Settings {
  readonly #cache = new Map<string, { state: ModuleState; at: number }>();
  readonly #listeners: ((payload: string) => void)[] = [];
  #listening = false;

  constructor(
    private readonly sql: Sql,
    private readonly modules: ModuleStore,
    private readonly log: Logger,
  ) {}

  async listen(): Promise<void> {
    if (this.#listening) return;
    this.#listening = true;
    await this.sql
      .listen(CONFIG_CHANNEL, (payload) => this.invalidate(payload))
      .catch((error) => {
        this.#listening = false;
        this.log.warn({ err: error }, 'config listener failed, falling back to TTL');
      });
  }

  onInvalidate(listener: (payload: string) => void): void {
    this.#listeners.push(listener);
  }

  invalidate(payload: string): void {
    this.#cache.delete(payload);
    for (const listener of this.#listeners) listener(payload);
  }

  async state(guildId: string, key: string): Promise<ModuleState> {
    const id = `${guildId}:${key}`;
    const hit = this.#cache.get(id);
    if (hit && Date.now() - hit.at < TTL) return hit.state;
    const state = await this.modules.state(guildId, key);
    this.#cache.set(id, { state, at: Date.now() });
    if (this.#cache.size > 50_000) this.#cache.clear();
    return state;
  }

  async enabled(guildId: string, key: string): Promise<boolean> {
    return (await this.state(guildId, key)).enabled;
  }

  async config<T extends z.ZodType>(guildId: string, key: string, schema: T): Promise<z.output<T>> {
    const { config } = await this.state(guildId, key);
    const parsed = schema.safeParse(config);
    return parsed.success ? parsed.data : schema.parse({});
  }
}
