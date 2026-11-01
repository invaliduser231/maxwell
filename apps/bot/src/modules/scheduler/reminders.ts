import { cancel, type Job } from '@maxwell/core';
import { type ReminderRow, ReminderStore } from '@maxwell/core/stores/scheduler';
import type { ModuleContext } from '../../runtime/module.js';
import { truncate } from '../../ui/format.js';
import { keys, type schedulerConfig } from './config.js';
import { copy } from './copy.js';

export const REMINDER_TEXT_LIMIT = 1_500;
const MEMBER_LIMIT = 10_000;

type Ctx = ModuleContext<typeof schedulerConfig>;

export type ReminderCheck =
  | { ok: true }
  | { ok: false; reason: 'off' | 'far' | 'many'; limit: number };

export function checkReminder(
  config: { reminders: boolean; maxReminderDays: number; maxRemindersPerMember: number },
  delayMs: number,
  existing: number,
): ReminderCheck {
  if (!config.reminders) return { ok: false, reason: 'off', limit: 0 };
  if (delayMs > config.maxReminderDays * 86_400_000) {
    return { ok: false, reason: 'far', limit: config.maxReminderDays };
  }
  if (existing >= config.maxRemindersPerMember) {
    return { ok: false, reason: 'many', limit: config.maxRemindersPerMember };
  }
  return { ok: true };
}

export class Reminders {
  readonly store: ReminderStore;

  constructor(private readonly ctx: Ctx) {
    this.store = new ReminderStore(ctx.services.sql);
  }

  async create(input: {
    guildId: string;
    channelId: string;
    userId: string;
    content: string;
    dueAt: Date;
  }): Promise<ReminderRow> {
    const row = await this.store.create({
      ...input,
      content: truncate(input.content.trim(), REMINDER_TEXT_LIMIT),
    });
    await this.#enqueue(row);
    return row;
  }

  async cancel(guildId: string, id: string, userId?: string): Promise<ReminderRow | null> {
    const row = await this.store.remove(guildId, id, userId);
    if (row) await cancel(this.ctx.services.sql, keys.reminder(row.id));
    return row;
  }

  async resume(guildId: string): Promise<number> {
    const rows = await this.store.pending(guildId);
    for (const row of rows) await this.#enqueue(row);
    return rows.length;
  }

  async exportMember(guildId: string, userId: string): Promise<Record<string, unknown> | null> {
    const rows = await this.store.forMember(guildId, userId, MEMBER_LIMIT);
    if (rows.length === 0) return null;
    return {
      reminders: rows.map((row) => ({
        id: row.id,
        number: row.number,
        channelId: row.channelId,
        content: row.content,
        dueAt: row.dueAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async forgetMember(guildId: string, userId: string): Promise<number> {
    const rows = await this.store.forMember(guildId, userId, MEMBER_LIMIT);
    for (const row of rows) await cancel(this.ctx.services.sql, keys.reminder(row.id));
    return this.store.forgetMember(guildId, userId);
  }

  async deliver(job: Job): Promise<void> {
    const id = String(job.payload.reminderId ?? '');
    if (!job.guildId || !/^\d+$/.test(id)) return;
    const pending = await this.store.get(id);
    if (!pending || pending.guildId !== job.guildId) return;
    if (!(await this.ctx.enabled(pending.guildId))) return;
    const row = await this.store.remove(pending.guildId, id);
    if (!row) return;

    const config = await this.ctx.config(row.guildId);
    const inChannel = () => this.#toChannel(row);
    const inDm = () => this.#toDm(row);
    const order = config.reminderDelivery === 'dm' ? [inDm, inChannel] : [inChannel, inDm];
    for (const attempt of order) {
      if (await attempt().catch(() => false)) return;
    }
    this.ctx.services.log.info(
      { guild: row.guildId, reminder: row.id },
      'reminder could not be delivered',
    );
  }

  async #toChannel(row: ReminderRow): Promise<boolean> {
    const { platform } = this.ctx.services;
    if (!(await platform.channelInGuild(row.guildId, row.channelId))) return false;
    const missing = await platform.missingBotPermissions(row.guildId, row.channelId, [
      'ViewChannel',
      'SendMessages',
    ]);
    if (missing.length) return false;
    await platform.send(row.channelId, {
      content: copy.deliver(row.userId, row.content, row.createdAt),
      mentionUsers: [row.userId],
    });
    return true;
  }

  async #toDm(row: ReminderRow): Promise<boolean> {
    const { platform } = this.ctx.services;
    const guild = await platform.guild(row.guildId).catch(() => null);
    return platform.sendDirect(
      row.userId,
      copy.deliverDm(guild?.name ?? null, row.content, row.createdAt),
    );
  }

  async #enqueue(row: ReminderRow): Promise<void> {
    await this.ctx.schedule('reminder', {
      guildId: row.guildId,
      runAt: row.dueAt,
      dedupeKey: keys.reminder(row.id),
      payload: { reminderId: row.id },
    });
  }
}
