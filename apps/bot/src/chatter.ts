import type { IncomingMessage } from './platform/types.js';
import type { Services } from './services.js';
import { uiCopy } from './ui/copy.js';

const ROUND_WINDOW = 5 * 60_000;

export const fallbackReaction = '\u{1F9F2}';

const thanks = /\b(thanks|thank you|thx|ty|good bot|nice one|danke|dankeschön|guter bot)\b/i;

const eggs: [RegExp, () => string][] = [
  [/\b(are you (a )?demon|bist du (ein )?d(ä|ae)mon)\b/i, () => uiCopy.eggs.demon],
  [/^(sort|sortier)\b/i, () => uiCopy.eggs.sort],
  [/\b((who|what) are you|wer bist du|was bist du)\b/i, () => uiCopy.eggs.who],
];

export class Chatter {
  readonly #rounds = new Map<string, { count: number; at: number }>();

  constructor(private readonly services: Services) {}

  async mentionOnly(message: IncomingMessage, prefix: string): Promise<void> {
    const key = `${message.channelId}:${message.author.id}`;
    const now = Date.now();
    const last = this.#rounds.get(key);
    const round = last && now - last.at < ROUND_WINDOW ? Math.min(last.count + 1, 2) : 0;
    this.#rounds.set(key, { count: round, at: now });
    if (this.#rounds.size > 5_000) this.#rounds.clear();

    if (round === 2) {
      const reacted = await this.#react(message, 'skeptical');
      if (reacted) return;
    }
    await this.services.platform.reply(message, this.services.voice.prefixHint(prefix, round));
  }

  async addressed(message: IncomingMessage, text: string): Promise<boolean> {
    for (const [pattern, answer] of eggs) {
      if (pattern.test(text)) {
        await this.services.platform.reply(message, answer());
        return true;
      }
    }
    return false;
  }

  async ambient(message: IncomingMessage): Promise<void> {
    const self = this.services.platform.selfId;
    if (!self || !message.content.includes(`<@${self}>`)) return;
    if (!thanks.test(message.content)) return;
    const reacted = await this.#react(message, 'happy');
    if (!reacted)
      await this.services.platform
        .react(message.channelId, message.id, fallbackReaction)
        .catch(() => {});
  }

  async #react(message: IncomingMessage, icon: 'happy' | 'skeptical'): Promise<boolean> {
    const emoji = this.services.voice.icons.reaction(icon);
    if (!emoji) return false;
    try {
      await this.services.platform.react(message.channelId, message.id, emoji);
      return true;
    } catch {
      return false;
    }
  }
}
