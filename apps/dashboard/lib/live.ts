import 'server-only';
import { CONFIG_CHANNEL, LIVE_CHANNEL, parseLive, STRUCTURE_MODULE } from '@maxwell/core';
import { db } from './db';
import { forgetBotCache } from './fluxer';

type Listener = (modules: string[]) => void;

const BATCH_MS = 250;

class Hub {
  readonly #listeners = new Map<string, Set<Listener>>();
  readonly #pending = new Map<string, Set<string>>();
  #started: Promise<void> | null = null;

  subscribe(guildId: string, listener: Listener): () => void {
    this.#start();
    let set = this.#listeners.get(guildId);
    if (!set) {
      set = new Set();
      this.#listeners.set(guildId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.#listeners.delete(guildId);
    };
  }

  #start(): void {
    if (this.#started) return;
    const { sql } = db();
    const onPayload = (payload: string) => {
      const parsed = parseLive(payload);
      if (parsed?.module === STRUCTURE_MODULE) forgetBotCache(parsed.guildId);
      this.#receive(payload);
    };
    const onConfig = (payload: string) => {
      const parsed = parseLive(payload);
      if (parsed) forgetBotCache(parsed.guildId);
      this.#receive(payload);
    };
    this.#started = Promise.all([
      sql.listen(LIVE_CHANNEL, onPayload),
      sql.listen(CONFIG_CHANNEL, onConfig),
    ])
      .then(() => undefined)
      .catch(() => {
        this.#started = null;
      });
  }

  #receive(payload: string): void {
    const parsed = parseLive(payload);
    if (!parsed || !this.#listeners.has(parsed.guildId)) return;
    const queued = this.#pending.get(parsed.guildId);
    if (queued) {
      queued.add(parsed.module);
      return;
    }
    this.#pending.set(parsed.guildId, new Set([parsed.module]));
    setTimeout(() => this.#flush(parsed.guildId), BATCH_MS);
  }

  #flush(guildId: string): void {
    const modules = this.#pending.get(guildId);
    this.#pending.delete(guildId);
    if (!modules) return;
    const list = [...modules];
    for (const listener of this.#listeners.get(guildId) ?? []) listener(list);
  }
}

const holder = globalThis as typeof globalThis & { __maxwellLive?: Hub };

export function liveHub(): Hub {
  holder.__maxwellLive ??= new Hub();
  return holder.__maxwellLive;
}
