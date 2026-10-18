import { type Actor, cancel, type Job } from '@maxwell/core';
import { type PollInput, type PollRow, PollStore } from '@maxwell/core/stores/events';
import type { Permission, ReactionEvent } from '../../platform/types.js';
import { type EventsContext, keys, refreshSlot } from './config.js';
import { audit, copy } from './copy.js';
import { numberEmojis, optionIndex } from './emoji.js';
import { renderPollCard } from './poll-card.js';
import { pollEmbed, receipt, winnerLine } from './render.js';
import { allReactors, dropBots, planVotes } from './sync.js';
import type { TargetCache } from './targets.js';

type PollFile = { name: string; data: Uint8Array };

export type PublishResult =
  | { ok: true; poll: PollRow }
  | { ok: false; reason: 'state' | 'channel' | 'permissions'; missing?: Permission[] };

export function pollPermissions(anonymous: boolean): Permission[] {
  const base: Permission[] = [
    'ViewChannel',
    'SendMessages',
    'EmbedLinks',
    'AddReactions',
    'ReadMessageHistory',
  ];
  return anonymous ? [...base, 'ManageMessages'] : base;
}

export class PollService {
  readonly store: PollStore;

  constructor(
    private readonly ctx: EventsContext,
    private readonly targets: TargetCache,
  ) {
    this.store = new PollStore(ctx.services.sql);
  }

  async create(input: PollInput, actor: Actor): Promise<PublishResult> {
    const poll = await this.store.create(input);
    const result = await this.publish(poll.guildId, poll.id);
    if (!result.ok) {
      await this.store.remove(poll.guildId, poll.id);
      return result;
    }
    await this.ctx.record(poll.guildId, actor, 'poll.create', audit.poll(poll.question), {
      after: { id: poll.id, number: poll.number, question: poll.question, options: poll.options },
      undo: { kind: 'poll.cancel', payload: { pollId: poll.id } },
    });
    return result;
  }

  async publish(guildId: string, pollId: string): Promise<PublishResult> {
    const poll = await this.store.get(guildId, pollId);
    if (poll?.status !== 'draft') return { ok: false, reason: 'state' };
    const config = await this.ctx.config(guildId);
    const channelId = poll.channelId ?? config.pollChannelId ?? config.channelId;
    const { platform, log } = this.ctx.services;
    if (!channelId || !(await platform.channelInGuild(guildId, channelId))) {
      return { ok: false, reason: 'channel' };
    }
    const missing = await platform.missingBotPermissions(
      guildId,
      channelId,
      pollPermissions(poll.anonymous),
    );
    if (missing.length) return { ok: false, reason: 'permissions', missing };

    const endsAt =
      poll.endsAt && poll.endsAt.getTime() <= Date.now()
        ? new Date(Date.now() + 60_000)
        : poll.endsAt;
    const shown = { ...poll, endsAt, status: 'open' as const };
    const empty = { counts: poll.options.map(() => 0), voters: 0, votes: 0 };
    const messageId = await platform.send(channelId, { embeds: [pollEmbed(shown, empty)] });
    this.targets.set(messageId, { kind: 'poll', id: poll.id });
    const opened = await this.store.open(poll.id, channelId, messageId);
    if (!opened) return { ok: false, reason: 'state' };

    for (const emoji of numberEmojis.slice(0, poll.options.length)) {
      await platform.react(channelId, messageId, emoji).catch((error) => {
        log.warn({ err: error, guild: guildId }, 'poll reaction failed');
      });
    }
    if (endsAt) {
      await this.ctx.schedule('poll.close', {
        guildId,
        runAt: endsAt,
        dedupeKey: keys.pollClose(poll.id),
        payload: { pollId: poll.id },
      });
    }
    return { ok: true, poll: opened };
  }

  async publishJob(job: Job): Promise<void> {
    const pollId = String(job.payload.pollId ?? '');
    if (!job.guildId || !(await this.ctx.enabled(job.guildId))) return;
    const result = await this.publish(job.guildId, pollId);
    if (!result.ok && result.reason !== 'state') {
      this.ctx.services.log.info(
        { guild: job.guildId, poll: pollId, reason: result.reason, missing: result.missing },
        'poll not published',
      );
    }
  }

  async close(guildId: string, pollId: string): Promise<PollRow | null> {
    const { platform, log } = this.ctx.services;
    const open = await this.store.get(guildId, pollId);
    if (open?.status === 'open') {
      await this.sync(open).catch((error) =>
        log.info({ err: error, guild: guildId, poll: pollId }, 'poll sync failed'),
      );
    }
    const poll = await this.store.close(guildId, pollId);
    if (!poll) return null;
    await cancel(this.ctx.services.sql, keys.pollClose(poll.id));
    const results = await this.store.results(poll);
    if (!poll.channelId || !poll.messageId) return poll;
    const channelId = poll.channelId;
    const messageId = poll.messageId;
    this.targets.set(messageId, null);

    const config = await this.ctx.config(guildId);
    const missing = await platform
      .missingBotPermissions(guildId, channelId, ['SendMessages', 'AttachFiles'])
      .catch(() => ['SendMessages', 'AttachFiles'] as Permission[]);
    const card =
      config.pollResultImage && !missing.includes('AttachFiles') && results.votes > 0
        ? await this.#card(poll, results)
        : null;

    const embed = pollEmbed(poll, results);
    let attached = false;
    if (card) {
      try {
        await platform.edit(channelId, messageId, {
          embeds: [{ ...pollEmbed(poll, results, true), imageUrl: `attachment://${card.name}` }],
          files: [card],
        });
        attached = true;
      } catch (error) {
        log.info({ err: error, guild: guildId }, 'poll card not attached');
      }
    }
    if (!attached) {
      await platform
        .edit(channelId, messageId, { embeds: [embed] })
        .catch((error) => log.info({ err: error, guild: guildId }, 'poll message not editable'));
    }
    for (const emoji of numberEmojis.slice(0, poll.options.length)) {
      await platform.unreact(channelId, messageId, emoji).catch(() => {});
    }

    if (missing.includes('SendMessages')) return poll;
    const files = card && !attached ? [card] : undefined;
    await platform
      .send(channelId, { content: winnerLine(poll, results), files, silent: true })
      .catch((error) => log.info({ err: error, guild: guildId }, 'poll result not posted'));
    return poll;
  }

  async #card(
    poll: PollRow,
    results: { counts: number[]; voters: number },
  ): Promise<PollFile | null> {
    const { cards, log } = this.ctx.services;
    try {
      const png = await renderPollCard({
        title: copy.poll.cardTitle,
        question: poll.question,
        subtitle: copy.poll.cardVoters(results.voters, poll.multiple),
        options: poll.options,
        counts: results.counts,
        style: await cards.forGuild(poll.guildId),
      });
      return { name: `poll-${poll.number}.png`, data: png };
    } catch (error) {
      log.warn({ err: error, guild: poll.guildId }, 'poll card failed');
      return null;
    }
  }

  async sync(poll: PollRow): Promise<boolean> {
    if (poll.status !== 'open' || !poll.channelId || !poll.messageId) return false;
    const { platform } = this.ctx.services;
    const channelId = poll.channelId;
    const messageId = poll.messageId;
    const emojis = numberEmojis.slice(0, poll.options.length);
    const reacted = new Map<string, number[]>();
    let complete = true;
    for (const [option, emoji] of emojis.entries()) {
      const found = await allReactors(platform, channelId, messageId, emoji);
      complete &&= found.complete;
      for (const userId of found.users) {
        const list = reacted.get(userId);
        if (list) list.push(option);
        else reacted.set(userId, [option]);
      }
    }
    const stored = await this.store.ballots(poll.id);
    await dropBots(platform, reacted, poll.anonymous ? new Map() : stored);

    if (poll.anonymous) {
      let changed = false;
      for (const [userId, options] of reacted) {
        for (const option of options) {
          if (await this.#anonymousVote(poll, userId, option)) changed = true;
        }
      }
      if (changed) await this.#render(poll);
      return changed;
    }

    const plan = planVotes(stored, reacted, poll.multiple, complete);
    for (const [userId, options] of plan.set) await this.store.setVotes(poll, userId, options);
    for (const { userId, option } of plan.unreact) {
      const emoji = numberEmojis[option];
      if (emoji) await platform.unreact(channelId, messageId, emoji, userId).catch(() => {});
    }
    const changed = plan.set.size > 0;
    if (changed) await this.#render(poll);
    return changed;
  }

  async syncJob(job: Job): Promise<void> {
    if (!job.guildId || !(await this.ctx.enabled(job.guildId))) return;
    const poll = await this.store.get(job.guildId, String(job.payload.pollId ?? ''));
    if (poll) await this.sync(poll);
  }

  async queueSyncs(): Promise<void> {
    for (const poll of await this.store.active()) {
      await this.ctx.schedule('poll.sync', {
        guildId: poll.guildId,
        dedupeKey: keys.pollSync(poll.id),
        payload: { pollId: poll.id },
      });
    }
  }

  async exportMember(guildId: string, userId: string): Promise<Record<string, unknown> | null> {
    const [votes, created] = await Promise.all([
      this.store.votesOfMember(guildId, userId),
      this.store.createdBy(guildId, userId),
    ]);
    if (votes.length === 0 && created.length === 0) return null;
    const byPoll = new Map<
      string,
      { pollId: string; number: number; question: string; choices: string[]; votedAt: string }
    >();
    for (const vote of votes) {
      const label = vote.options[vote.option] ?? String(vote.option + 1);
      const entry = byPoll.get(vote.pollId);
      if (entry) entry.choices.push(label);
      else {
        byPoll.set(vote.pollId, {
          pollId: vote.pollId,
          number: vote.number,
          question: vote.question,
          choices: [label],
          votedAt: vote.createdAt.toISOString(),
        });
      }
    }
    return { pollVotes: [...byPoll.values()], pollsCreated: created };
  }

  async forgetMember(guildId: string, userId: string): Promise<void> {
    const votes = await this.store.votesOfMember(guildId, userId);
    await this.store.forgetMember(guildId, userId);
    await this.store.forgetCreator(guildId, userId);
    const { platform } = this.ctx.services;
    const refreshed = new Set<string>();
    for (const vote of votes) {
      if (vote.status !== 'open' || !vote.channelId || !vote.messageId) continue;
      const emoji = numberEmojis[vote.option];
      if (!vote.anonymous && emoji) {
        await platform.unreact(vote.channelId, vote.messageId, emoji, userId).catch(() => {});
      }
      if (refreshed.has(vote.pollId)) continue;
      refreshed.add(vote.pollId);
      await this.#queueRefresh({ id: vote.pollId, guildId });
    }
  }

  async #anonymousVote(poll: PollRow, userId: string, option: number): Promise<boolean> {
    const { platform } = this.ctx.services;
    const emoji = numberEmojis[option];
    if (poll.channelId && poll.messageId && emoji) {
      await platform.unreact(poll.channelId, poll.messageId, emoji, userId).catch(() => {});
    }
    const outcome = await this.store.vote(poll, userId, option, true);
    const config = await this.ctx.config(poll.guildId);
    const text = receipt(outcome, poll, option);
    if (config.voteReceipts && text) await platform.sendDirect(userId, text);
    return outcome !== 'kept';
  }

  async #render(poll: PollRow): Promise<void> {
    if (!poll.channelId || !poll.messageId) return;
    const results = await this.store.results(poll);
    await this.ctx.services.platform
      .edit(poll.channelId, poll.messageId, { embeds: [pollEmbed(poll, results)] })
      .catch(() => {});
  }

  async closeJob(job: Job): Promise<void> {
    const pollId = String(job.payload.pollId ?? '');
    if (!job.guildId) return;
    await this.close(job.guildId, pollId);
  }

  async cancelPoll(guildId: string, pollId: string): Promise<PollRow | null> {
    const poll = await this.store.cancel(guildId, pollId);
    if (!poll) return null;
    await cancel(this.ctx.services.sql, keys.pollClose(poll.id));
    if (poll.channelId && poll.messageId) {
      this.targets.set(poll.messageId, null);
      const results = await this.store.results(poll);
      await this.ctx.services.platform
        .edit(poll.channelId, poll.messageId, { embeds: [pollEmbed(poll, results)] })
        .catch(() => {});
    }
    return poll;
  }

  async refresh(job: Job): Promise<void> {
    const pollId = String(job.payload.pollId ?? '');
    if (!job.guildId) return;
    const poll = await this.store.get(job.guildId, pollId);
    if (poll?.status === 'open') await this.#render(poll);
  }

  async onReaction(poll: PollRow, reaction: ReactionEvent, added: boolean): Promise<void> {
    if (poll.status !== 'open' || !poll.channelId || !poll.messageId) return;
    if (poll.endsAt && poll.endsAt.getTime() <= Date.now()) return;
    const option = optionIndex(reaction.emoji);
    if (option < 0 || option >= poll.options.length) return;
    const { platform } = this.ctx.services;
    const { userId } = reaction;
    const channelId = poll.channelId;
    const messageId = poll.messageId;
    if (poll.anonymous) {
      if (!added) return;
      if (await this.#anonymousVote(poll, userId, option)) await this.#queueRefresh(poll);
      return;
    }

    if (added) {
      const before = poll.multiple ? [] : await this.store.votesOf(poll.id, userId);
      const outcome = await this.store.vote(poll, userId, option, false);
      for (const previous of before) {
        if (previous === option) continue;
        const old = numberEmojis[previous];
        if (old) await platform.unreact(channelId, messageId, old, userId).catch(() => {});
      }
      if (outcome !== 'kept') await this.#queueRefresh(poll);
      return;
    }
    if (await this.store.unvote(poll.id, userId, option)) await this.#queueRefresh(poll);
  }

  async onMessageRemoved(guildId: string, pollId: string, messageId: string): Promise<void> {
    const current = await this.store.get(guildId, pollId);
    if (current?.messageId !== messageId) return;
    const poll = await this.store.cancel(guildId, pollId);
    if (poll) await cancel(this.ctx.services.sql, keys.pollClose(poll.id));
  }

  async preload(): Promise<void> {
    for (const poll of await this.store.active()) {
      if (poll.messageId) this.targets.set(poll.messageId, { kind: 'poll', id: poll.id });
    }
  }

  async #queueRefresh(poll: Pick<PollRow, 'id' | 'guildId'>): Promise<void> {
    const { slot, runAt } = refreshSlot();
    await this.ctx.schedule('poll.refresh', {
      guildId: poll.guildId,
      runAt,
      dedupeKey: keys.pollRefresh(poll.id, slot),
      payload: { pollId: poll.id },
    });
  }
}
