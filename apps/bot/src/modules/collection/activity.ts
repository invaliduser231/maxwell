import type { CollectionStore } from '@maxwell/core/stores/collection';
import type { Logger } from '../../log.js';
import type { IncomingMessage } from '../../platform/types.js';

const MEMBERS_TTL = 5 * 60_000;
const GUILD_LIMIT = 2_000;
const BUFFER_LIMIT = 20_000;
const FLUSH_MS = 60_000;

export class Activity {
  readonly #buffer = new Map<string, Map<string, number>>();
  readonly #members = new Map<string, { ids: Set<string>; at: number }>();
  #size = 0;
  #timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: CollectionStore,
    private readonly log: Logger,
  ) {}

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.#timer.unref();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.flush();
  }

  forget(guildId: string): void {
    this.#members.delete(guildId);
  }

  forgetMember(guildId: string, userId: string): void {
    this.#members.delete(guildId);
    const counts = this.#buffer.get(guildId);
    if (counts?.delete(userId)) this.#size -= 1;
  }

  async onMessage(message: IncomingMessage): Promise<void> {
    const guildId = message.guildId;
    if (!guildId || message.author.bot || message.fromWebhook) return;
    const members = await this.#optedIn(guildId);
    if (!members.has(message.author.id)) return;
    const counts = this.#buffer.get(guildId) ?? new Map<string, number>();
    if (!counts.has(message.author.id)) this.#size += 1;
    counts.set(message.author.id, (counts.get(message.author.id) ?? 0) + 1);
    this.#buffer.set(guildId, counts);
    if (this.#size >= BUFFER_LIMIT) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.#buffer.size === 0) return;
    const batch = [...this.#buffer];
    this.#buffer.clear();
    this.#size = 0;
    const day = new Date().toISOString().slice(0, 10);
    for (const [guildId, counts] of batch) {
      await this.store
        .addActivity(guildId, counts, day)
        .catch((error) => this.log.warn({ err: error, guild: guildId }, 'activity flush failed'));
    }
  }

  async #optedIn(guildId: string): Promise<Set<string>> {
    const hit = this.#members.get(guildId);
    if (hit && Date.now() - hit.at < MEMBERS_TTL) return hit.ids;
    const ids = new Set(await this.store.optedIn(guildId));
    if (this.#members.size >= GUILD_LIMIT) this.#members.clear();
    this.#members.set(guildId, { ids, at: Date.now() });
    return ids;
  }
}
