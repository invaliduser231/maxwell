import type {
  SuggestionStatus,
  SuggestionsConfig,
  suggestionsConfig,
} from '@maxwell/core/modules/suggestions';
import type { StatusChange, Suggestion, SuggestionStore } from '@maxwell/core/stores/suggestions';
import type { Permission, ReactionEvent, UserRef } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { lines } from '../../ui/format.js';
import { copy, fallbackVotes } from './copy.js';
import { suggestionEmbed } from './render.js';

type Context = ModuleContext<typeof suggestionsConfig>;

const CACHE_LIMIT = 5_000;

export function reactionForm(emoji: string): string {
  return emoji.trim().replace(/^<a?:/, '').replace(/>$/, '');
}

export function sameEmoji(a: string, b: string): boolean {
  return reactionForm(a).replaceAll('️', '') === reactionForm(b).replaceAll('️', '');
}

export function voteEmojis(config: SuggestionsConfig): { up: string; down: string } {
  const up = config.upEmoji ? reactionForm(config.upEmoji) : '';
  const down = config.downEmoji ? reactionForm(config.downEmoji) : '';
  return { up: up || fallbackVotes.up, down: down || fallbackVotes.down };
}

export function voteOf(
  suggestion: Pick<Suggestion, 'upEmoji' | 'downEmoji'>,
  emoji: string,
): -1 | 1 | null {
  if (sameEmoji(suggestion.upEmoji, emoji)) return 1;
  if (sameEmoji(suggestion.downEmoji, emoji)) return -1;
  return null;
}

export type PostResult =
  | { ok: true; suggestion: Suggestion; channelId: string }
  | { ok: false; reason: 'channel' | 'gone' | 'permissions'; missing?: Permission[] };

export class SuggestionBoard {
  readonly #messages = new Map<string, string | null>();

  constructor(
    private readonly ctx: Context,
    private readonly store: SuggestionStore,
  ) {}

  async post(guildId: string, author: UserRef, content: string): Promise<PostResult> {
    const { platform, log } = this.ctx.services;
    const config = await this.ctx.config(guildId);
    const channelId = config.channelId;
    if (!channelId) return { ok: false, reason: 'channel' };
    if (!(await platform.channelInGuild(guildId, channelId).catch(() => false))) {
      return { ok: false, reason: 'gone' };
    }
    const missing = await platform.missingBotPermissions(guildId, channelId, [
      'SendMessages',
      'EmbedLinks',
      'AddReactions',
      'ReadMessageHistory',
    ]);
    if (missing.length > 0) return { ok: false, reason: 'permissions', missing };

    const emojis = voteEmojis(config);
    const suggestion = await this.store.create({
      guildId,
      channelId,
      authorId: author.id,
      content,
      upEmoji: emojis.up,
      downEmoji: emojis.down,
    });
    let messageId: string;
    try {
      messageId = await platform.send(channelId, { embeds: [suggestionEmbed(suggestion, author)] });
    } catch (error) {
      await this.store.discard(suggestion.id);
      throw error;
    }
    this.#remember(messageId, suggestion.id);
    await this.store.attach(suggestion.id, messageId);
    for (const emoji of [emojis.up, emojis.down]) {
      await platform.react(channelId, messageId, emoji).catch((err) => {
        log.warn({ err, guild: guildId, suggestion: suggestion.id }, 'suggestion reaction failed');
      });
    }
    if (config.thread) {
      await platform
        .startThread(channelId, messageId, copy.threadName(String(suggestion.number), content))
        .catch((err) => {
          log.warn({ err, guild: guildId, suggestion: suggestion.id }, 'suggestion thread failed');
        });
    }
    return { ok: true, suggestion: { ...suggestion, messageId }, channelId };
  }

  async onReaction(reaction: ReactionEvent): Promise<void> {
    const found = await this.#forReaction(reaction);
    if (!found) return;
    const { suggestion, vote } = found;
    const tally = await this.store.vote(suggestion.id, reaction.userId, vote);
    if (tally.previous === -vote) {
      const other = vote === 1 ? suggestion.downEmoji : suggestion.upEmoji;
      await this.ctx.services.platform
        .unreact(reaction.channelId, reaction.messageId, other, reaction.userId)
        .catch(() => {});
    }
  }

  async onReactionRemove(reaction: ReactionEvent): Promise<void> {
    const found = await this.#forReaction(reaction);
    if (!found) return;
    await this.store.unvote(found.suggestion.id, reaction.userId, found.vote);
  }

  async setStatus(
    guildId: string,
    id: string,
    status: SuggestionStatus,
    reason: string | null,
    by: string | null,
    notify: boolean,
  ): Promise<StatusChange | null> {
    const change = await this.store.setStatus(guildId, id, status, reason, by);
    if (!change) return null;
    const { after } = change;
    const { platform, log } = this.ctx.services;
    const author = after.authorId ? await platform.user(after.authorId).catch(() => null) : null;

    if (after.messageId) {
      await platform
        .edit(after.channelId, after.messageId, { embeds: [suggestionEmbed(after, author)] })
        .catch((error) => {
          log.warn(
            { err: error, guild: guildId, suggestion: id },
            'suggestion message not updated',
          );
        });
    }

    const config = await this.ctx.config(guildId);
    if (after.authorId && notify && config.notifyAuthor && change.before.status !== status) {
      const guild = await platform.guild(guildId).catch(() => null);
      await platform
        .sendDirect(
          after.authorId,
          lines(
            copy.statusDirect(
              after.number,
              guild?.name ?? '',
              copy.statusNames[status],
              after.content,
            ),
            after.reason && copy.statusDirectReason(after.reason),
          ),
        )
        .catch(() => false);
    }
    return change;
  }

  async anonymise(suggestions: readonly Suggestion[]): Promise<void> {
    const { platform } = this.ctx.services;
    for (const suggestion of suggestions) {
      if (!suggestion.messageId) continue;
      await platform
        .edit(suggestion.channelId, suggestion.messageId, {
          embeds: [suggestionEmbed(suggestion, null)],
        })
        .catch(() => {});
    }
  }

  async #forReaction(
    reaction: ReactionEvent,
  ): Promise<{ suggestion: Suggestion; vote: -1 | 1 } | null> {
    if (!reaction.guildId || reaction.bot) return null;
    if (reaction.userId === this.ctx.services.platform.selfId) return null;
    const cached = this.#messages.get(reaction.messageId);
    if (cached === null) return null;
    const suggestion = await this.store.byMessage(reaction.messageId);
    this.#remember(reaction.messageId, suggestion?.id ?? null);
    if (!suggestion || suggestion.guildId !== reaction.guildId) return null;
    const vote = voteOf(suggestion, reaction.emoji);
    return vote === null ? null : { suggestion, vote };
  }

  #remember(messageId: string, id: string | null): void {
    this.#messages.delete(messageId);
    this.#messages.set(messageId, id);
    if (this.#messages.size > CACHE_LIMIT) {
      const oldest = this.#messages.keys().next().value;
      if (oldest !== undefined) this.#messages.delete(oldest);
    }
  }
}
