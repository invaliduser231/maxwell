import type { Job } from '@maxwell/core';
import type { ScheduledMessage } from '@maxwell/core/modules/scheduler';
import { isDue, MessageStateStore, nextRun } from '@maxwell/core/stores/scheduler';
import { mention } from '../../commands/mentions.js';
import type { OutgoingMessage, Permission } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { palette } from '../../ui/palette.js';
import { guildTimezone, keys, type schedulerConfig } from './config.js';
import { stateErrors } from './copy.js';

export const LATE_LIMIT = 60 * 60_000;

type Ctx = ModuleContext<typeof schedulerConfig>;

export function renderScheduled(message: ScheduledMessage): OutgoingMessage {
  const ping = message.pingRoleId ? mention.role(message.pingRoleId) : null;
  const mentionRoles = message.pingRoleId ? [message.pingRoleId] : [];
  if (message.embed) {
    return {
      content: ping ?? undefined,
      embeds: [{ color: palette.north, description: message.content }],
      mentionRoles,
    };
  }
  return { content: ping ? `${ping} ${message.content}` : message.content, mentionRoles };
}

export interface FirePlan {
  send: boolean;
  next: number | null;
}

export function planFire(
  message: ScheduledMessage | undefined,
  timezone: string,
  runAt: number,
  now: number,
): FirePlan | null {
  if (!message?.enabled) return null;
  if (!isDue(message.rule, timezone, runAt)) return null;
  return {
    send: now - runAt <= LATE_LIMIT,
    next: nextRun(message.rule, timezone, Math.max(runAt, now)),
  };
}

export class ScheduledMessages {
  readonly #state: MessageStateStore;

  constructor(private readonly ctx: Ctx) {
    this.#state = new MessageStateStore(ctx.services.sql);
  }

  async sync(guildId: string): Promise<number> {
    const config = await this.ctx.config(guildId);
    const timezone = await guildTimezone(this.ctx.services, guildId, config.timezone);
    const now = Date.now();
    let planned = 0;
    for (const message of config.messages) {
      const next = message.enabled ? nextRun(message.rule, timezone, now) : null;
      await this.#state.planned(guildId, message.id, next === null ? null : new Date(next));
      if (next === null) continue;
      await this.#enqueue(guildId, message.id, next);
      planned++;
    }
    await this.#state.prune(
      guildId,
      config.messages.map((message) => message.id),
    );
    return planned;
  }

  async fire(job: Job): Promise<void> {
    const guildId = job.guildId;
    const messageId = String(job.payload.messageId ?? '');
    const runAt = Number(job.payload.runAt);
    if (!guildId || !messageId || !Number.isFinite(runAt)) return;
    if (!(await this.ctx.enabled(guildId))) return;

    const config = await this.ctx.config(guildId);
    const timezone = await guildTimezone(this.ctx.services, guildId, config.timezone);
    const message = config.messages.find((entry) => entry.id === messageId);
    const plan = planFire(message, timezone, runAt, Date.now());
    if (!plan || !message) return;

    if (plan.next !== null) await this.#enqueue(guildId, messageId, plan.next);
    const error = plan.send ? await this.#deliver(guildId, message) : stateErrors.late;
    await this.#state
      .sent(guildId, messageId, new Date(), error, plan.next === null ? null : new Date(plan.next))
      .catch((err) =>
        this.ctx.services.log.warn({ err, guild: guildId }, 'scheduler state write failed'),
      );
  }

  async postNow(job: Job): Promise<void> {
    const guildId = job.guildId;
    const messageId = String(job.payload.messageId ?? '');
    if (!guildId || !messageId) return;
    const config = await this.ctx.config(guildId);
    const message = config.messages.find((entry) => entry.id === messageId);
    if (!message) return;
    const error = await this.#deliver(guildId, message);
    const state = (await this.#state.list(guildId)).find((row) => row.messageId === messageId);
    await this.#state.sent(guildId, messageId, new Date(), error, state?.nextRunAt ?? null);
  }

  async #enqueue(guildId: string, messageId: string, runAt: number): Promise<void> {
    await this.ctx.schedule('message', {
      guildId,
      runAt: new Date(runAt),
      dedupeKey: keys.message(guildId, messageId, runAt),
      payload: { messageId, runAt },
    });
  }

  async #deliver(guildId: string, message: ScheduledMessage): Promise<string | null> {
    const { platform, log } = this.ctx.services;
    try {
      if (!(await platform.channelInGuild(guildId, message.channelId))) return stateErrors.channel;
      const needed: Permission[] = ['ViewChannel', 'SendMessages'];
      const missing = await platform.missingBotPermissions(guildId, message.channelId, needed);
      if (missing.length) return stateErrors.permissions(missing);
      await platform.send(message.channelId, renderScheduled(message));
      return null;
    } catch (error) {
      log.warn({ err: error, guild: guildId, message: message.id }, 'scheduled message failed');
      return stateErrors.failed;
    }
  }
}
