import type { IncomingMessage } from '../../platform/types.js';

export interface CachedMessage {
  id: string;
  channelId: string;
  guildId: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  avatarUrl: string;
  bot: boolean;
  content: string;
  attachments: string[];
  roles: string[];
  createdAt: Date;
}

const MAX_CONTENT = 2_000;

export class MessageCache {
  readonly #messages = new Map<string, CachedMessage>();

  constructor(private readonly max = 10_000) {}

  add(message: IncomingMessage): void {
    if (!message.guildId) return;
    const entry: CachedMessage = {
      id: message.id,
      channelId: message.channelId,
      guildId: message.guildId,
      authorId: message.author.id,
      authorName: message.author.displayName,
      authorUsername: message.author.username,
      avatarUrl: message.author.avatarUrl,
      bot: message.author.bot || message.fromWebhook,
      content: message.content.slice(0, MAX_CONTENT),
      attachments: message.attachments.slice(0, 10).map((file) => file.filename),
      roles: message.memberRoles,
      createdAt: message.createdAt,
    };
    this.#messages.delete(message.id);
    this.#messages.set(message.id, entry);
    while (this.#messages.size > this.max) {
      const oldest = this.#messages.keys().next().value;
      if (oldest === undefined) break;
      this.#messages.delete(oldest);
    }
  }

  get(id: string): CachedMessage | null {
    return this.#messages.get(id) ?? null;
  }

  take(id: string): CachedMessage | null {
    const entry = this.#messages.get(id) ?? null;
    this.#messages.delete(id);
    return entry;
  }

  update(message: IncomingMessage): string | null {
    const before = this.#messages.get(message.id)?.content ?? null;
    this.add(message);
    return before;
  }

  forgetAuthor(guildId: string, userId: string): number {
    let removed = 0;
    for (const [id, entry] of this.#messages) {
      if (entry.guildId === guildId && entry.authorId === userId) {
        this.#messages.delete(id);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.#messages.clear();
  }

  get size(): number {
    return this.#messages.size;
  }
}
