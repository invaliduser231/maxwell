import type { FormSession } from '@maxwell/core/stores/forms';

const MAX_SESSIONS = 20_000;

export class FormInbox {
  readonly #users = new Map<string, string | null>();
  readonly #channels = new Map<string, string>();

  load(sessions: readonly FormSession[]): void {
    this.#users.clear();
    this.#channels.clear();
    for (const session of sessions.slice(0, MAX_SESSIONS))
      this.add(session.userId, session.channelId);
  }

  add(userId: string, channelId: string | null): void {
    this.remove(userId);
    if (this.#users.size >= MAX_SESSIONS) {
      const oldest = this.#users.keys().next();
      if (!oldest.done) this.remove(oldest.value);
    }
    this.#users.set(userId, channelId);
    if (channelId) this.#channels.set(channelId, userId);
  }

  remove(userId: string): void {
    const channelId = this.#users.get(userId);
    if (channelId) this.#channels.delete(channelId);
    this.#users.delete(userId);
  }

  hasUser(userId: string): boolean {
    return this.#users.has(userId);
  }

  userForChannel(channelId: string): string | null {
    return this.#channels.get(channelId) ?? null;
  }

  get size(): number {
    return this.#users.size;
  }
}

const inboxes = new WeakMap<object, FormInbox>();

export function formInboxFor(owner: object): FormInbox {
  let inbox = inboxes.get(owner);
  if (!inbox) {
    inbox = new FormInbox();
    inboxes.set(owner, inbox);
  }
  return inbox;
}
