import { randomUUID } from 'node:crypto';
import { triviaQuestion } from '@maxwell/core/modules/games';
import type { TriviaSession } from '@maxwell/core/stores/games';
import type { GuildContext } from '../../commands/types.js';
import type { IncomingMessage } from '../../platform/types.js';
import { lines, subtext } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import type { Schedule } from '../economy/shop.js';
import { copy } from './copy.js';
import { isCorrect, LETTERS, pickQuestion } from './logic.js';
import type { Games } from './service.js';

const SESSION_LIMIT = 1_000;
const LAST_LIMIT = 5_000;

export class Trivia {
  readonly #sessions = new Map<string, TriviaSession>();
  readonly #last = new Map<string, number>();

  constructor(
    private readonly games: Games,
    private readonly schedule: Schedule,
  ) {}

  async load(): Promise<number> {
    const { log } = this.games.services;
    let loaded = 0;
    for (const session of await this.games.store.openTrivia()) {
      const question = triviaQuestion.safeParse(session.question);
      if (!question.success) {
        log.warn(
          { guild: session.guildId, channel: session.channelId },
          'stored trivia unreadable',
        );
        await this.games.store.endTrivia(session.channelId, session.id);
        continue;
      }
      this.#track({ ...session, question: question.data });
      await this.#scheduleEnd(session);
      loaded += 1;
    }
    return loaded;
  }

  #track(session: TriviaSession): void {
    this.#sessions.delete(session.channelId);
    if (this.#sessions.size >= SESSION_LIMIT) {
      const oldest = this.#sessions.keys().next().value;
      if (oldest !== undefined) this.#sessions.delete(oldest);
    }
    this.#sessions.set(session.channelId, session);
  }

  #scheduleEnd(session: TriviaSession): Promise<string | null> {
    return this.schedule('triviaEnd', {
      guildId: session.guildId,
      runAt: session.expiresAt,
      payload: { channelId: session.channelId, sessionId: session.id },
      dedupeKey: `games.trivia:${session.id}`,
    });
  }

  async start(ctx: GuildContext): Promise<void> {
    const config = await this.games.config(ctx.guildId);
    if (!(await this.games.allowed(ctx, config.trivia.enabled, copy.names.trivia))) return;
    const questions = config.trivia.questions;
    const index = pickQuestion(questions, this.#last.get(ctx.guildId) ?? null);
    const question = index === null ? undefined : questions[index];
    if (index === null || !question) {
      await ctx.reply({ content: copy.trivia.none, deleteAfter: 15_000 });
      return;
    }

    const session: TriviaSession = {
      id: randomUUID(),
      guildId: ctx.guildId,
      channelId: ctx.message.channelId,
      question,
      expiresAt: new Date(Date.now() + config.trivia.answerSeconds * 1000),
    };
    if (!(await this.games.store.startTrivia(session))) {
      await ctx.reply({ content: copy.trivia.running, deleteAfter: 8_000 });
      return;
    }
    this.#track(session);
    if (this.#last.size >= LAST_LIMIT) this.#last.clear();
    this.#last.set(ctx.guildId, index);

    try {
      await ctx.reply({
        embeds: [
          {
            color: palette.north,
            title: copy.trivia.title,
            description: lines(
              question.question,
              question.choices.length > 0 && '',
              ...question.choices.map((choice, i) => `**${LETTERS[i]}** ${choice}`),
              '',
              subtext(copy.trivia.prompt(session.expiresAt)),
            ),
          },
        ],
      });
    } catch (error) {
      this.#sessions.delete(session.channelId);
      await this.games.store.endTrivia(session.channelId, session.id);
      throw error;
    }
    await this.#scheduleEnd(session);
  }

  async onMessage(message: IncomingMessage): Promise<void> {
    const session = this.#sessions.get(message.channelId);
    if (!session || !message.guildId || message.author.bot || message.fromWebhook) return;
    if (!isCorrect(session.question, message.content)) return;
    if (this.#sessions.get(message.channelId) !== session) return;
    this.#sessions.delete(message.channelId);
    const won = await this.games.store.endTrivia(session.channelId, session.id, true);
    if (!won) return;

    const { platform, voice } = this.games.services;
    const userId = message.author.id;
    await this.games.store.score(session.guildId, 'trivia', userId, { win: true });
    const reward = await this.games.reward(session.guildId, userId, 'trivia');
    const answer = session.question.answers[0] ?? '';
    await platform.reply(
      message,
      `${voice.icon('ok')}${copy.trivia.won(userId, answer)}${reward ? ` ${reward}.` : ''}`,
    );
  }

  async end(channelId: string, sessionId: string): Promise<void> {
    if (this.#sessions.get(channelId)?.id === sessionId) this.#sessions.delete(channelId);
    const session = await this.games.store.endTrivia(channelId, sessionId);
    if (!session) return;
    const { platform, log } = this.games.services;
    await platform
      .send(channelId, copy.trivia.timeout(session.question.answers[0] ?? ''))
      .catch((error) => log.info({ err: error, guild: session.guildId }, 'trivia channel gone'));
  }
}
