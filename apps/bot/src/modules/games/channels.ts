import type { IncomingMessage } from '../../platform/types.js';
import { lines } from '../../ui/format.js';
import { confirmEmojis } from '../economy/confirm.js';
import { copy } from './copy.js';
import { parseCount, parseWord } from './logic.js';
import type { Games } from './service.js';

export class Serial {
  readonly #chains = new Map<string, Promise<void>>();

  run(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.#chains.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    this.#chains.set(key, next);
    void next
      .catch(() => {})
      .finally(() => {
        if (this.#chains.get(key) === next) this.#chains.delete(key);
      });
    return next;
  }

  get size(): number {
    return this.#chains.size;
  }
}

export class ChannelGames {
  readonly #serial = new Serial();

  constructor(private readonly games: Games) {}

  async onMessage(message: IncomingMessage): Promise<void> {
    const guildId = message.guildId;
    if (!guildId || message.author.bot || message.fromWebhook) return;
    const config = await this.games.config(guildId);
    if (config.counting.enabled && config.counting.channelId === message.channelId) {
      const value = parseCount(message.content);
      if (value === null) return;
      await this.#serial.run(message.channelId, () => this.#count(guildId, message, value));
      return;
    }
    if (config.wordchain.enabled && config.wordchain.channelId === message.channelId) {
      const word = parseWord(message.content);
      if (word === null) return;
      await this.#serial.run(message.channelId, () => this.#word(guildId, message, word));
    }
  }

  async #react(message: IncomingMessage, ok: boolean): Promise<void> {
    const { platform, voice, log } = this.games.services;
    const emojis = confirmEmojis(voice.icons);
    await platform
      .react(message.channelId, message.id, ok ? emojis.yes : emojis.no)
      .catch((error) => log.info({ err: error, guild: message.guildId }, 'game reaction failed'));
  }

  async #say(message: IncomingMessage, text: string): Promise<void> {
    const { platform, log } = this.games.services;
    await platform
      .reply(message, { content: text, silent: true })
      .catch((error) => log.info({ err: error, guild: message.guildId }, 'game reply failed'));
  }

  async #count(guildId: string, message: IncomingMessage, value: number): Promise<void> {
    const config = (await this.games.config(guildId)).counting;
    const userId = message.author.id;
    const result = await this.games.store.count(guildId, message.channelId, userId, value, config);
    if (result.ok) {
      await this.#react(message, true);
      await this.games.store.score(guildId, 'counting', userId, {
        win: true,
        best: result.current,
      });
      if (config.rewardEvery > 0 && result.current % config.rewardEvery === 0) {
        const reward = await this.games.reward(guildId, userId, 'counting');
        if (reward)
          await this.#say(message, copy.counting.milestone(result.current, userId, reward));
      }
      return;
    }
    await this.#react(message, false);
    const headline =
      result.reason === 'twice'
        ? copy.counting.twice(userId, result.reset)
        : copy.counting.broke(userId, result.reached, result.reset);
    await this.#say(
      message,
      lines(
        headline,
        result.reason === 'wrong' && !result.reset && copy.counting.expected(result.expected),
      ),
    );
  }

  async #word(guildId: string, message: IncomingMessage, word: string): Promise<void> {
    const config = await this.games.config(guildId);
    const rules = config.wordchain;
    const userId = message.author.id;
    if ([...word].length < rules.minLength) return;
    const result = await this.games.store.word(guildId, message.channelId, userId, word, rules);
    if (result.ok) {
      await this.#react(message, true);
      await this.games.store.score(guildId, 'wordchain', userId, {
        win: true,
        best: result.length,
      });
      return;
    }
    await this.#react(message, false);
    const reason =
      result.reason === 'letter'
        ? copy.wordchain.letter(word, result.letter ?? '')
        : result.reason === 'repeat'
          ? copy.wordchain.repeat(word)
          : copy.wordchain.twice;
    await this.#say(message, lines(reason, result.reset && copy.wordchain.reset(result.reached)));
  }
}
