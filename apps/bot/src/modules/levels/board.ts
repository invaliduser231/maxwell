import type { Permission, Platform, ReactionEvent } from '../../platform/types.js';
import type { IconSet } from '../../ui/icons.js';

export const PAGER_IDLE = 120_000;
const LIMIT = 500;
const fallback = { prev: '◀️', next: '▶️' };

export interface CardPage {
  content: string;
  image: Uint8Array;
  pages: number;
}

export type RenderPage = (page: number) => Promise<CardPage | null>;

interface Session {
  channelId: string;
  userId: string;
  page: number;
  pages: number;
  render: RenderPage;
  timer: NodeJS.Timeout;
  manageMessages: boolean;
  queue: Promise<void>;
}

export interface PagerStart {
  guildId: string;
  channelId: string;
  userId: string;
  page: number;
  render: RenderPage;
  send(page: CardPage): Promise<string>;
}

export function step(page: number, pages: number, delta: number): number {
  if (pages <= 1) return 1;
  return ((page - 1 + delta + pages) % pages) + 1;
}

export class CardPager {
  readonly #sessions = new Map<string, Session>();
  readonly prev: string;
  readonly next: string;

  constructor(
    private readonly platform: Platform,
    icons: IconSet,
    private readonly idle = PAGER_IDLE,
  ) {
    this.prev = icons.reaction('prev') ?? fallback.prev;
    this.next = icons.reaction('next') ?? fallback.next;
  }

  async canPage(guildId: string, channelId: string): Promise<{ react: boolean; manage: boolean }> {
    const missing: Permission[] = await this.platform
      .missingBotPermissions(guildId, channelId, ['AddReactions', 'ManageMessages'])
      .catch(() => ['AddReactions']);
    return {
      react: !missing.includes('AddReactions'),
      manage: !missing.includes('ManageMessages'),
    };
  }

  async start(input: PagerStart): Promise<boolean> {
    const first = await input.render(input.page);
    if (!first) return false;
    const messageId = await input.send(first);
    if (first.pages <= 1) return true;

    const allowed = await this.canPage(input.guildId, input.channelId);
    if (!allowed.react) return true;

    if (this.#sessions.size >= LIMIT) this.#drop(this.#sessions.keys().next().value as string);
    this.#sessions.set(messageId, {
      channelId: input.channelId,
      userId: input.userId,
      page: input.page,
      pages: first.pages,
      render: input.render,
      timer: this.#expire(messageId),
      manageMessages: allowed.manage,
      queue: Promise.resolve(),
    });
    await this.platform.react(input.channelId, messageId, this.prev);
    await this.platform.react(input.channelId, messageId, this.next);
    return true;
  }

  get size(): number {
    return this.#sessions.size;
  }

  async onReaction(reaction: ReactionEvent): Promise<void> {
    if (reaction.bot) return;
    const session = this.#sessions.get(reaction.messageId);
    if (!session || reaction.userId !== session.userId) return;
    const delta = reaction.emoji === this.next ? 1 : reaction.emoji === this.prev ? -1 : 0;
    if (delta === 0) return;

    clearTimeout(session.timer);
    session.timer = this.#expire(reaction.messageId);
    const run = session.queue.then(() => this.#flip(reaction, session, delta));
    session.queue = run.catch(() => {});
    await run;
  }

  async #flip(reaction: ReactionEvent, session: Session, delta: number): Promise<void> {
    const target = step(session.page, session.pages, delta);
    const page = await session.render(target);
    if (page) {
      session.page = Math.min(target, page.pages);
      session.pages = page.pages;
      await this.platform.edit(session.channelId, reaction.messageId, {
        content: page.content,
        files: [{ name: 'leaderboard.png', data: page.image }],
      });
    }
    if (session.manageMessages) {
      await this.platform
        .unreact(session.channelId, reaction.messageId, reaction.emoji, reaction.userId)
        .catch(() => {});
    }
  }

  #expire(messageId: string): NodeJS.Timeout {
    const timer = setTimeout(() => this.#drop(messageId), this.idle);
    timer.unref();
    return timer;
  }

  #drop(messageId: string): void {
    const session = this.#sessions.get(messageId);
    this.#sessions.delete(messageId);
    if (!session) return;
    clearTimeout(session.timer);
    for (const emoji of [this.prev, this.next]) {
      this.platform.unreact(session.channelId, messageId, emoji).catch(() => {});
    }
  }
}
