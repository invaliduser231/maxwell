import { type Actor, cancel, type Job } from '@maxwell/core';
import { economyConfig } from '@maxwell/core/modules/economy';
import {
  type EventInput,
  type EventRow,
  EventStore,
  nextOccurrence,
  type RsvpStatus,
  rsvpStatuses,
} from '@maxwell/core/stores/events';
import { mention } from '../../commands/mentions.js';
import type { Permission, ReactionEvent } from '../../platform/types.js';
import { truncate } from '../../ui/format.js';
import { type EventsConfig, type EventsContext, keys, refreshSlot } from './config.js';
import { audit, copy } from './copy.js';
import { reactionEmoji, rsvpStatusFor } from './emoji.js';
import { type EventReward, eventEmbed, eventEnd, eventWhere } from './render.js';
import { allReactors, dropBots, planRsvps } from './sync.js';
import type { TargetCache } from './targets.js';

const REMINDER_RECIPIENTS = 500;
const REWARD_RECIPIENTS = 5_000;
const REWARD_BATCH = 1_000;
const ANNOUNCE_PERMISSIONS: Permission[] = [
  'ViewChannel',
  'SendMessages',
  'EmbedLinks',
  'AddReactions',
  'ReadMessageHistory',
];

export class EventService {
  readonly store: EventStore;

  constructor(
    private readonly ctx: EventsContext,
    private readonly targets: TargetCache,
  ) {
    this.store = new EventStore(ctx.services.sql);
  }

  async missingIn(guildId: string, channelId: string): Promise<Permission[] | null> {
    const { platform } = this.ctx.services;
    if (!(await platform.channelInGuild(guildId, channelId))) return null;
    return platform.missingBotPermissions(guildId, channelId, ANNOUNCE_PERMISSIONS);
  }

  async create(input: EventInput, actor: Actor): Promise<EventRow> {
    const row = await this.store.create(input);
    await this.ctx.record(row.guildId, actor, 'event.create', audit.create(row.title), {
      after: {
        id: row.id,
        number: row.number,
        title: row.title,
        startsAt: row.startsAt,
        recurrence: row.recurrence,
      },
      undo: { kind: 'event.cancel', payload: { eventId: row.id } },
    });
    await this.publish(row.id);
    return row;
  }

  async cancel(guildId: string, id: string, actor: Actor | null): Promise<EventRow | null> {
    const row = await this.store.setStatus(guildId, id, 'cancelled');
    if (!row) return null;
    await this.#dropJobs(row);
    await this.#render(row);
    if (actor) {
      await this.ctx.record(guildId, actor, 'event.cancel', audit.cancel(row.title), {
        before: { status: 'scheduled' },
        after: { status: 'cancelled' },
        undo: { kind: 'event.restore', payload: { eventId: row.id } },
      });
    }
    return row;
  }

  async restore(guildId: string, id: string): Promise<void> {
    const row = await this.store.setStatus(guildId, id, 'scheduled');
    if (row) await this.publish(row.id);
  }

  async publish(eventId: string): Promise<void> {
    const row = await this.store.byId(eventId);
    if (!row) return;
    if (row.status !== 'scheduled') {
      await this.#render(row);
      return;
    }

    const config = await this.ctx.config(row.guildId);
    if (!(await this.ctx.enabled(row.guildId))) {
      await this.#scheduleJobs(row, config);
      return;
    }
    const { platform, log } = this.ctx.services;
    if (row.messageId && row.channelId && (await this.#render(row, config))) {
      await this.#scheduleJobs(row, config);
      return;
    }

    const channelId = row.channelId ?? config.channelId;
    if (!channelId) {
      log.info({ guild: row.guildId, event: row.id }, 'event has no channel');
      return;
    }
    const missing = await this.missingIn(row.guildId, channelId);
    if (missing === null || missing.some((p) => p !== 'AddReactions')) {
      log.info({ guild: row.guildId, event: row.id, missing }, 'cannot announce event');
      return;
    }

    const reward = await this.reward(row.guildId, config);
    const embed = eventEmbed(row, { going: 0, maybe: 0, no: 0 }, [], config.rsvp, reward);
    const ping = row.pingRoleId;
    const messageId = await platform.send(channelId, {
      content: ping ? mention.role(ping) : undefined,
      mentionRoles: ping ? [ping] : [],
      embeds: [embed],
    });
    this.targets.set(messageId, { kind: 'event', id: row.id });
    await this.store.setMessage(row.id, channelId, messageId);
    if (!missing.includes('AddReactions')) {
      for (const emoji of [config.rsvp.going, config.rsvp.maybe, config.rsvp.no]) {
        await platform.react(channelId, messageId, reactionEmoji(emoji)).catch((error) => {
          log.warn({ err: error, guild: row.guildId }, 'rsvp reaction failed');
        });
      }
    }
    await this.#scheduleJobs(row, config);
  }

  async remind(job: Job): Promise<void> {
    const row = await this.#current(job);
    if (!row || !(await this.ctx.enabled(row.guildId))) return;
    const { platform } = this.ctx.services;
    const guild = await platform.guild(row.guildId).catch(() => null);
    const users = await this.store.rsvpUsers(row, 'going', REMINDER_RECIPIENTS);
    const text = copy.reminder(row.title, row.startsAt, eventWhere(row), guild?.name ?? null);
    for (const userId of users) {
      await platform.sendDirect(userId, text);
    }
  }

  async start(job: Job): Promise<void> {
    const row = await this.#current(job);
    if (!row || !(await this.ctx.enabled(row.guildId))) return;
    const config = await this.ctx.config(row.guildId);
    const reward = await this.reward(row.guildId, config);
    if (!reward) return;
    const { log, jobs } = this.ctx.services;
    await this.sync(row).catch((error) =>
      log.info({ err: error, guild: row.guildId, event: row.id }, 'rsvp sync failed'),
    );
    const users = await this.store.rsvpUsers(row, 'going', REWARD_RECIPIENTS);
    const start = row.startsAt.getTime();
    for (let part = 0; part * REWARD_BATCH < users.length; part++) {
      await jobs.enqueue({
        kind: 'economy.reward',
        guildId: row.guildId,
        dedupeKey: keys.reward(row.id, start, part),
        payload: {
          userIds: users.slice(part * REWARD_BATCH, (part + 1) * REWARD_BATCH),
          amount: reward.amount,
          reason: truncate(copy.rewardReason(row.title), 200),
        },
      });
    }
  }

  async reward(guildId: string, config: EventsConfig): Promise<EventReward | null> {
    if (config.rewardAmount <= 0) return null;
    const { settings } = this.ctx.services;
    if (!(await settings.enabled(guildId, 'economy'))) return null;
    const economy = await settings.config(guildId, 'economy', economyConfig);
    const unit = config.rewardAmount === 1 ? economy.currency.singular : economy.currency.name;
    return { amount: config.rewardAmount, unit };
  }

  async sync(row: EventRow): Promise<boolean> {
    if (row.status !== 'scheduled' || !row.channelId || !row.messageId) return false;
    const config = await this.ctx.config(row.guildId);
    const { platform } = this.ctx.services;
    const reacted = new Map<string, RsvpStatus[]>();
    let complete = true;
    for (const status of rsvpStatuses) {
      const emoji = reactionEmoji(config.rsvp[status]);
      const found = await allReactors(platform, row.channelId, row.messageId, emoji);
      complete &&= found.complete;
      for (const userId of found.users) {
        const list = reacted.get(userId);
        if (list) list.push(status);
        else reacted.set(userId, [status]);
      }
    }
    const stored = await this.store.rsvpMap(row);
    await dropBots(platform, reacted, stored);
    const plan = planRsvps(stored, reacted, complete);
    for (const { userId, status } of plan.set) await this.store.setRsvp(row, userId, status);
    for (const { userId, status } of plan.clear) await this.store.clearRsvp(row, userId, status);
    for (const { userId, status } of plan.unreact) {
      await this.#unreact(row, config, status, userId);
    }
    const changed = plan.set.length + plan.clear.length > 0;
    if (changed) await this.#render(row, config);
    return changed;
  }

  async syncJob(job: Job): Promise<void> {
    if (!job.guildId || !(await this.ctx.enabled(job.guildId))) return;
    const row = await this.store.get(job.guildId, String(job.payload.eventId ?? ''));
    if (row) await this.sync(row);
  }

  async queueSyncs(): Promise<void> {
    for (const row of await this.store.scheduled()) {
      if (!row.messageId || !row.channelId) continue;
      await this.ctx.schedule('rsvp.sync', {
        guildId: row.guildId,
        dedupeKey: keys.rsvpSync(row.id),
        payload: { eventId: row.id },
      });
    }
  }

  async exportMember(guildId: string, userId: string): Promise<Record<string, unknown> | null> {
    const [rsvps, created] = await Promise.all([
      this.store.rsvpsOfMember(guildId, userId),
      this.store.createdBy(guildId, userId),
    ]);
    if (rsvps.length === 0 && created.length === 0) return null;
    return {
      rsvps: rsvps.map((rsvp) => ({
        eventId: rsvp.eventId,
        number: rsvp.number,
        title: rsvp.title,
        occurrence: rsvp.sequence,
        startsAt: rsvp.current ? rsvp.startsAt.toISOString() : null,
        status: rsvp.status,
        updatedAt: rsvp.updatedAt.toISOString(),
      })),
      eventsCreated: created,
    };
  }

  async forgetMember(guildId: string, userId: string): Promise<void> {
    const rsvps = await this.store.rsvpsOfMember(guildId, userId);
    await this.store.forgetMember(guildId, userId);
    await this.store.forgetCreator(guildId, userId);
    const live = rsvps.filter((rsvp) => rsvp.current && rsvp.channelId && rsvp.messageId);
    if (live.length === 0) return;
    const config = await this.ctx.config(guildId);
    for (const rsvp of live) {
      await this.#unreact(rsvp, config, rsvp.status, userId);
      await this.#queueRefresh(guildId, rsvp.eventId);
    }
  }

  async end(job: Job): Promise<void> {
    const row = await this.#current(job);
    if (!row) return;
    if (row.recurrence === 'none') {
      const ended = await this.store.finish(row.id, row.startsAt);
      if (ended) await this.#render(ended);
      return;
    }
    const next = nextOccurrence(
      row.anchorAt.getTime(),
      row.timezone,
      row.recurrence,
      Math.max(row.startsAt.getTime(), Date.now()),
    );
    if (next === null) {
      const ended = await this.store.finish(row.id, row.startsAt);
      if (ended) await this.#render(ended);
      return;
    }
    await this.#render({ ...row, status: 'ended' });
    if (row.messageId) this.targets.set(row.messageId, null);
    const advanced = await this.store.advance(row.id, row.startsAt, new Date(next));
    if (advanced) await this.publish(advanced.id);
  }

  async refresh(job: Job): Promise<void> {
    const id = String(job.payload.eventId ?? '');
    const row = await this.store.byId(id);
    if (row?.status === 'scheduled') await this.#render(row);
  }

  async remove(job: Job): Promise<void> {
    const id = String(job.payload.eventId ?? '');
    if (!job.guildId) return;
    const row = await this.store.get(job.guildId, id);
    if (!row) return;
    await this.#dropJobs(row);
    if (row.channelId && row.messageId) {
      this.targets.forget(row.messageId);
      await this.ctx.services.platform.delete(row.channelId, row.messageId).catch(() => {});
    }
    await this.store.remove(job.guildId, id);
  }

  async onReaction(row: EventRow, reaction: ReactionEvent, added: boolean): Promise<void> {
    if (row.status !== 'scheduled' || !row.guildId) return;
    const config = await this.ctx.config(row.guildId);
    const status = rsvpStatusFor(reaction.emoji, config.rsvp);
    if (!status) return;

    if (added) {
      const previous = await this.store.setRsvp(row, reaction.userId, status);
      if (previous === status) return;
      if (previous) await this.#unreact(row, config, previous, reaction.userId);
    } else if (!(await this.store.clearRsvp(row, reaction.userId, status))) {
      return;
    }

    await this.#queueRefresh(row.guildId, row.id);
  }

  async onMessageRemoved(eventId: string, messageId: string): Promise<void> {
    const row = await this.store.byId(eventId);
    if (row?.messageId === messageId) await this.store.setMessage(row.id, null, null);
  }

  async preload(): Promise<void> {
    for (const row of await this.store.scheduled()) {
      if (row.messageId) this.targets.set(row.messageId, { kind: 'event', id: row.id });
    }
  }

  async #queueRefresh(guildId: string, eventId: string): Promise<void> {
    const { slot, runAt } = refreshSlot();
    await this.ctx.schedule('rsvp.refresh', {
      guildId,
      runAt,
      dedupeKey: keys.rsvpRefresh(eventId, slot),
      payload: { eventId },
    });
  }

  async #unreact(
    row: Pick<EventRow, 'channelId' | 'messageId'>,
    config: EventsConfig,
    status: RsvpStatus,
    userId: string,
  ): Promise<void> {
    if (!row.channelId || !row.messageId) return;
    await this.ctx.services.platform
      .unreact(row.channelId, row.messageId, reactionEmoji(config.rsvp[status]), userId)
      .catch(() => {});
  }

  async #current(job: Job): Promise<EventRow | null> {
    const id = String(job.payload.eventId ?? '');
    const startsAt = Number(job.payload.startsAt);
    const row = await this.store.byId(id);
    if (row?.status !== 'scheduled') return null;
    return row.startsAt.getTime() === startsAt ? row : null;
  }

  async #render(row: EventRow, known?: EventsConfig): Promise<boolean> {
    if (!row.channelId || !row.messageId) return false;
    const config = known ?? (await this.ctx.config(row.guildId));
    const [counts, going, reward] = await Promise.all([
      this.store.rsvpCounts(row),
      this.store.rsvpUsers(row, 'going', 40),
      this.reward(row.guildId, config),
    ]);
    try {
      await this.ctx.services.platform.edit(row.channelId, row.messageId, {
        embeds: [eventEmbed(row, counts, going, config.rsvp, reward)],
      });
      return true;
    } catch (error) {
      this.ctx.services.log.info(
        { err: error, guild: row.guildId, event: row.id },
        'event announcement not editable',
      );
      return false;
    }
  }

  async #scheduleJobs(row: EventRow, config: EventsConfig): Promise<void> {
    const start = row.startsAt.getTime();
    const remindAt = start - config.reminderMinutes * 60_000;
    if (config.reminderMinutes > 0 && remindAt > Date.now()) {
      await this.ctx.schedule('reminder', {
        guildId: row.guildId,
        runAt: new Date(remindAt),
        dedupeKey: keys.reminder(row.id, start),
        payload: { eventId: row.id, startsAt: start },
      });
    }
    if (start > Date.now()) {
      await this.ctx.schedule('start', {
        guildId: row.guildId,
        runAt: row.startsAt,
        dedupeKey: keys.start(row.id, start),
        payload: { eventId: row.id, startsAt: start },
      });
    }
    await this.ctx.schedule('end', {
      guildId: row.guildId,
      runAt: eventEnd(row, config.defaultDurationMinutes),
      dedupeKey: keys.end(row.id, start),
      payload: { eventId: row.id, startsAt: start },
    });
  }

  async #dropJobs(row: EventRow): Promise<void> {
    const start = row.startsAt.getTime();
    await cancel(this.ctx.services.sql, keys.reminder(row.id, start));
    await cancel(this.ctx.services.sql, keys.end(row.id, start));
    await cancel(this.ctx.services.sql, keys.start(row.id, start));
  }
}
