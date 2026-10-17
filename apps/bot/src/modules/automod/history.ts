import type { AutomodStore, StoredMessage } from '@maxwell/core/stores/automod';
import type { Logger } from '../../log.js';
import type { IncomingMessage } from '../../platform/types.js';

const FLUSH_MS = 3_000;
const FLUSH_SIZE = 250;
const BUFFER_CAP = 5_000;

export function toStored(message: IncomingMessage, guildId: string): StoredMessage {
  return {
    guildId,
    messageId: message.id,
    channelId: message.channelId,
    authorId: message.author.id,
    authorRoles: [...message.memberRoles],
    authorBot: message.author.bot || message.fromWebhook,
    content: message.content,
    mentionUsers: new Set(message.mentionUsers).size,
    mentionRoles: new Set(message.mentionRoles).size,
    createdAt: message.createdAt,
  };
}

export class MessageHistory {
  #buffer: StoredMessage[] = [];
  #timer: NodeJS.Timeout | null = null;
  #flushing: Promise<void> | null = null;

  constructor(
    private readonly store: AutomodStore,
    private readonly log: Logger,
  ) {}

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.#timer.unref();
  }

  get pending(): number {
    return this.#buffer.length;
  }

  add(message: StoredMessage): void {
    if (!message.content && message.mentionUsers === 0 && message.mentionRoles === 0) return;
    this.#buffer.push(message);
    if (this.#buffer.length > BUFFER_CAP) this.#buffer.splice(0, this.#buffer.length - BUFFER_CAP);
    if (this.#buffer.length >= FLUSH_SIZE) void this.flush();
  }

  async edit(guildId: string, messageId: string, content: string): Promise<void> {
    const buffered = this.#buffer.find(
      (entry) => entry.guildId === guildId && entry.messageId === messageId,
    );
    if (buffered) {
      buffered.content = content;
      return;
    }
    await this.store.editMessage(guildId, messageId, content);
  }

  async forget(guildId: string, userId: string): Promise<void> {
    this.#buffer = this.#buffer.filter(
      (entry) => entry.guildId !== guildId || entry.authorId !== userId,
    );
    if (this.#flushing) await this.#flushing;
  }

  async flush(): Promise<void> {
    if (this.#flushing) return this.#flushing;
    if (this.#buffer.length === 0) return;
    const batch = this.#buffer;
    this.#buffer = [];
    this.#flushing = this.store
      .saveMessages(batch)
      .catch((error) => {
        this.log.warn({ err: error, count: batch.length }, 'automod history flush failed');
      })
      .finally(() => {
        this.#flushing = null;
      });
    return this.#flushing;
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.flush();
    await this.flush();
  }
}
