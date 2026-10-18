import type { MessageRemoval, ReactionEvent } from '../../platform/types.js';
import { snowflakeDate } from '../../ui/format.js';
import type { EventsContext } from './config.js';
import { optionIndex, rsvpStatusFor } from './emoji.js';
import type { EventService } from './events.js';
import type { PollService } from './polls.js';
import type { Target, TargetCache } from './targets.js';

const FRESH_MS = 2 * 60_000;

export class ReactionRouter {
  constructor(
    private readonly ctx: EventsContext,
    private readonly targets: TargetCache,
    private readonly events: EventService,
    private readonly polls: PollService,
  ) {}

  async handle(reaction: ReactionEvent, added: boolean): Promise<void> {
    const { guildId } = reaction;
    if (!guildId || reaction.bot || reaction.userId === this.ctx.services.platform.selfId) return;
    if (this.targets.get(reaction.messageId) === null) return;
    if (!(await this.#relevant(guildId, reaction.emoji))) return;

    const target = await this.#resolve(reaction.messageId);
    if (!target) return;
    if (target.kind === 'poll') {
      const poll = await this.polls.store.get(guildId, target.id);
      if (poll?.messageId === reaction.messageId)
        await this.polls.onReaction(poll, reaction, added);
      return;
    }
    const event = await this.events.store.get(guildId, target.id);
    if (event?.messageId === reaction.messageId) {
      await this.events.onReaction(event, reaction, added);
    }
  }

  async removed(removal: MessageRemoval): Promise<void> {
    const target = this.targets.get(removal.id);
    if (!target || !removal.guildId) return;
    this.targets.forget(removal.id);
    if (target.kind === 'poll') {
      await this.polls.onMessageRemoved(removal.guildId, target.id, removal.id);
    } else {
      await this.events.onMessageRemoved(target.id, removal.id);
    }
  }

  async #relevant(guildId: string, emoji: string): Promise<boolean> {
    if (optionIndex(emoji) >= 0) return true;
    const config = await this.ctx.config(guildId);
    return rsvpStatusFor(emoji, config.rsvp) !== null;
  }

  async #resolve(messageId: string): Promise<Target | null> {
    const cached = this.targets.get(messageId);
    if (cached !== undefined) return cached;
    const poll = await this.polls.store.byMessage(messageId);
    if (poll) {
      const target: Target = { kind: 'poll', id: poll.id };
      this.targets.set(messageId, target);
      return target;
    }
    const event = await this.events.store.byMessage(messageId);
    if (event) {
      const target: Target = { kind: 'event', id: event.id };
      this.targets.set(messageId, target);
      return target;
    }
    if (Date.now() - snowflakeDate(messageId).getTime() > FRESH_MS) {
      this.targets.set(messageId, null);
    }
    return null;
  }
}
