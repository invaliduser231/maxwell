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
  readonly #order = new Map<string, string>();
  readonly #guilds = new Map<string, Map<string, CachedMessage>>();

  constructor(
    private readonly max = 50_000,
    private readonly perGuild = 2_000,
  ) {}

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
    this.#remove(message.id);
    let guild = this.#guilds.get(entry.guildId);
    if (!guild) {
      guild = new Map();
      this.#guilds.set(entry.guildId, guild);
    }
    guild.set(entry.id, entry);
    this.#order.set(entry.id, entry.guildId);
    while (guild.size > this.perGuild) {
      const oldest = guild.keys().next().value;
      if (oldest === undefined) break;
      this.#remove(oldest);
    }
    while (this.#order.size > this.max) {
      const oldest = this.#order.keys().next().value;
      if (oldest === undefined) break;
      this.#remove(oldest);
    }
  }

  get(id: string): CachedMessage | null {
    const guildId = this.#order.get(id);
    return guildId ? (this.#guilds.get(guildId)?.get(id) ?? null) : null;
  }

  take(id: string): CachedMessage | null {
    const entry = this.get(id);
    this.#remove(id);
    return entry;
  }

  update(message: IncomingMessage): string | null {
    const before = this.get(message.id)?.content ?? null;
    this.add(message);
    return before;
  }

  forgetAuthor(guildId: string, userId: string): number {
    const guild = this.#guilds.get(guildId);
    if (!guild) return 0;
    let removed = 0;
    for (const [id, entry] of guild) {
      if (entry.authorId !== userId) continue;
      this.#remove(id);
      removed++;
    }
    return removed;
  }

  clear(): void {
    this.#order.clear();
    this.#guilds.clear();
  }

  get size(): number {
    return this.#order.size;
  }

  #remove(id: string): void {
    const guildId = this.#order.get(id);
    if (guildId === undefined) return;
    this.#order.delete(id);
    const guild = this.#guilds.get(guildId);
    if (!guild) return;
    guild.delete(id);
    if (guild.size === 0) this.#guilds.delete(guildId);
  }
}
