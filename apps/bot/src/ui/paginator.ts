import type { CommandContext } from '../commands/types.js';
import { type Language, language, withLanguage } from '../i18n/language.js';
import type { Embed, Platform, ReactionEvent } from '../platform/types.js';
import { uiCopy } from './copy.js';
import type { IconSet } from './icons.js';

const IDLE = 60_000;
const fallback = { prev: '◀️', next: '▶️' };

interface Session {
  channelId: string;
  messageId: string;
  userId: string;
  pages: Embed[];
  index: number;
  timer: NodeJS.Timeout;
  manageMessages: boolean;
  language: Language;
}

export function withPageFooter(page: Embed, index: number, total: number): Embed {
  if (total <= 1) return page;
  const label = uiCopy.page(index + 1, total);
  return { ...page, footer: page.footer ? `${page.footer} / ${label}` : label };
}

export class Paginator {
  readonly #sessions = new Map<string, Session>();
  readonly #prev: string;
  readonly #next: string;

  constructor(
    private readonly platform: Platform,
    icons: IconSet,
  ) {
    this.#prev = icons.reaction('prev') ?? fallback.prev;
    this.#next = icons.reaction('next') ?? fallback.next;
    platform.on('reaction', (reaction) => {
      const session = this.#sessions.get(reaction.messageId);
      if (!session) return;
      withLanguage(session.language, () => this.#onReaction(reaction)).catch(() => {});
    });
  }

  async send(ctx: CommandContext, pages: Embed[], start = 0): Promise<void> {
    const total = pages.length;
    const index = Math.min(Math.max(start, 0), Math.max(total - 1, 0));
    const first = pages[index];
    if (!first) return;

    const messageId = await ctx.reply({ embeds: [withPageFooter(first, index, total)] });
    if (total <= 1 || !ctx.guildId) return;

    const missing = await this.platform.missingBotPermissions(ctx.guildId, ctx.message.channelId, [
      'AddReactions',
      'ManageMessages',
    ]);
    if (missing.includes('AddReactions')) return;

    const session: Session = {
      channelId: ctx.message.channelId,
      messageId,
      userId: ctx.message.author.id,
      pages,
      index,
      timer: this.#expire(messageId),
      manageMessages: !missing.includes('ManageMessages'),
      language: language(),
    };
    this.#sessions.set(messageId, session);
    await this.platform.react(session.channelId, messageId, this.#prev);
    await this.platform.react(session.channelId, messageId, this.#next);
  }

  #expire(messageId: string): NodeJS.Timeout {
    const timer = setTimeout(() => {
      const session = this.#sessions.get(messageId);
      this.#sessions.delete(messageId);
      if (!session) return;
      for (const emoji of [this.#prev, this.#next]) {
        this.platform.unreact(session.channelId, messageId, emoji).catch(() => {});
      }
    }, IDLE);
    timer.unref();
    return timer;
  }

  async #onReaction(reaction: ReactionEvent): Promise<void> {
    const session = this.#sessions.get(reaction.messageId);
    if (!session || reaction.userId !== session.userId) return;
    const step = reaction.emoji === this.#next ? 1 : reaction.emoji === this.#prev ? -1 : 0;
    if (step === 0) return;

    const total = session.pages.length;
    session.index = (session.index + step + total) % total;
    clearTimeout(session.timer);
    session.timer = this.#expire(session.messageId);

    const page = session.pages[session.index];
    if (page) {
      await this.platform.edit(session.channelId, session.messageId, {
        embeds: [withPageFooter(page, session.index, total)],
      });
    }
    if (session.manageMessages) {
      await this.platform
        .unreact(session.channelId, session.messageId, reaction.emoji, reaction.userId)
        .catch(() => {});
    }
  }
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
