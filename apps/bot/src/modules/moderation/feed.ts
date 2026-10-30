import { enqueue } from '@maxwell/core';
import { type InboxItem, InboxStore } from '@maxwell/core/stores/inbox';
import type { Services } from '../../services.js';

const NOTIFY_DELAY = 3_000;

export type CheckState = 'undelivered' | 'failed' | 'expired';

export class InboxFeed {
  readonly #store: InboxStore;

  constructor(private readonly services: Services) {
    this.#store = new InboxStore(services.sql);
  }

  async gate(guildId: string, held: number): Promise<void> {
    if (held <= 0) return;
    if (!(await this.#on(guildId))) return;
    const { item } = await this.#store.openGate(guildId, String(held));
    await this.#notify(item);
  }

  async gateClosed(guildId: string, held: number, outcome: string, by: string | null) {
    if (held > 0) {
      await this.gate(guildId, held);
      return;
    }
    const item = await this.#store.closeGate(guildId, outcome, by);
    if (item) await this.#notify(item);
  }

  async check(guildId: string, userId: string, checkId: string, state: CheckState) {
    if (!(await this.#on(guildId))) return;
    const item = await this.#store.openCheck(guildId, userId, checkId, state);
    if (item) await this.#notify(item);
  }

  async checkClosed(guildId: string, checkId: string, outcome: string, by: string | null) {
    const item = await this.#store.closeCheck(guildId, checkId, outcome, by);
    if (item) await this.#notify(item);
  }

  async checksClosedFor(guildId: string, userId: string, outcome: string, by: string | null) {
    for (const item of await this.#store.closeChecksFor(guildId, userId, outcome, by)) {
      await this.#notify(item);
    }
  }

  async #on(guildId: string): Promise<boolean> {
    return this.services.settings.enabled(guildId, 'moderation');
  }

  async #notify(item: InboxItem): Promise<void> {
    await enqueue(this.services.sql, {
      kind: 'moderation.inbox.notify',
      guildId: item.guildId,
      payload: { number: item.number },
      runAt: new Date(Date.now() + NOTIFY_DELAY),
      dedupeKey: `moderation.inbox.notify:${item.guildId}:${item.number}`,
    });
  }
}
