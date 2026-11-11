import type { Platform, ReactionEvent } from '../../platform/types.js';

const LIMIT = 10_000;
const VARIATION = String.fromCodePoint(0xfe0f);

export const key = (...codes: number[]) => String.fromCodePoint(...codes, 0xfe0f);

export const bare = (emoji: string) => emoji.replaceAll(VARIATION, '');

export function pressed<T extends string>(emoji: string, keys: Record<T, string>): T | null {
  const wanted = bare(emoji);
  for (const [name, value] of Object.entries(keys) as [T, string][]) {
    if (bare(value) === wanted) return name;
  }
  return null;
}

export interface Seat {
  guildId: string;
  userId: string;
  tidy: boolean;
}

export class Seats {
  readonly #seats = new Map<string, Seat>();

  constructor(private readonly platform: () => Platform) {}

  sit(messageId: string, seat: Seat): void {
    if (this.#seats.size >= LIMIT) {
      const oldest = this.#seats.keys().next().value;
      if (oldest !== undefined) this.#seats.delete(oldest);
    }
    this.#seats.set(messageId, seat);
  }

  leave(messageId: string | null | undefined): void {
    if (messageId) this.#seats.delete(messageId);
  }

  async open(
    guildId: string,
    channelId: string,
    messageId: string,
    userId: string,
    keys: string[],
  ) {
    const platform = this.platform();
    const missing = await platform
      .missingBotPermissions(guildId, channelId, ['AddReactions', 'ManageMessages'])
      .catch(() => ['AddReactions']);
    if (missing.includes('AddReactions')) return;
    this.sit(messageId, { guildId, userId, tidy: !missing.includes('ManageMessages') });
    for (const emoji of keys) await platform.react(channelId, messageId, emoji).catch(() => {});
  }

  async close(channelId: string, messageId: string | null | undefined, keys: string[]) {
    if (!messageId) return;
    this.leave(messageId);
    const platform = this.platform();
    for (const emoji of keys) await platform.unreact(channelId, messageId, emoji).catch(() => {});
  }

  async press(reaction: ReactionEvent, added: boolean): Promise<Seat | null> {
    if (reaction.bot) return null;
    const seat = this.#seats.get(reaction.messageId);
    if (!seat || reaction.userId !== seat.userId) return null;
    if (!added && seat.tidy) return null;
    if (added && seat.tidy) {
      await this.platform()
        .unreact(reaction.channelId, reaction.messageId, reaction.emoji, reaction.userId)
        .catch(() => {});
    }
    return seat;
  }
}
