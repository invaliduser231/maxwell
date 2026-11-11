import { cancel, type Job } from '@maxwell/core';
import { type ReminderRow, ReminderStore } from '@maxwell/core/stores/scheduler';
import type { ReactionEvent } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { lines, subtext, truncate } from '../../ui/format.js';
import { confirmEmojis } from '../economy/confirm.js';
import { keys, type schedulerConfig } from './config.js';
import { copy } from './copy.js';

export const REMINDER_TEXT_LIMIT = 1_500;
const MEMBER_LIMIT = 10_000;
const BUTTON_LIMIT = 5_000;
const SOON = 10 * 60_000;
const LATER = 60 * 60_000;
const VARIATION = String.fromCodePoint(0xfe0f);
const snooze = { soon: String.fromCodePoint(0x23f0), later: String.fromCodePoint(0x1f4a4) };
const bare = (emoji: string) => emoji.replaceAll(VARIATION, '');

type Button =
  | { kind: 'set'; guildId: string; userId: string; id: string; number: number }
  | {
      kind: 'due';
      guildId: string;
      channelId: string;
      userId: string;
      content: string;
      createdAt: Date;
    };

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
  readonly #buttons = new Map<string, Button>();

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

  #remember(messageId: string, button: Button): void {
    if (this.#buttons.size >= BUTTON_LIMIT) {
      const oldest = this.#buttons.keys().next().value;
      if (oldest !== undefined) this.#buttons.delete(oldest);
    }
    this.#buttons.set(messageId, button);
  }

  async offerCancel(channelId: string, messageId: string, row: ReminderRow): Promise<void> {
    const { platform, voice } = this.ctx.services;
    this.#remember(messageId, {
      kind: 'set',
      guildId: row.guildId,
      userId: row.userId,
      id: row.id,
      number: row.number,
    });
    await platform.react(channelId, messageId, confirmEmojis(voice.icons).no).catch(() => {});
  }

  async onReaction(reaction: ReactionEvent): Promise<void> {
    const button = this.#buttons.get(reaction.messageId);
    if (!button || reaction.bot || reaction.userId !== button.userId) return;
    const { platform, voice } = this.ctx.services;
    const pressed = bare(reaction.emoji);

    if (button.kind === 'set') {
      const no = confirmEmojis(voice.icons).no;
      if (pressed !== bare(no)) return;
      this.#buttons.delete(reaction.messageId);
      const row = await this.cancel(button.guildId, button.id, button.userId);
      await platform.unreact(reaction.channelId, reaction.messageId, no).catch(() => {});
      if (row) {
        await platform
          .edit(reaction.channelId, reaction.messageId, copy.cancelled(row.number))
          .catch(() => {});
      }
      return;
    }

    const delay = pressed === bare(snooze.soon) ? SOON : pressed === bare(snooze.later) ? LATER : 0;
    if (!delay) return;
    this.#buttons.delete(reaction.messageId);
    const row = await this.create({
      guildId: button.guildId,
      channelId: button.channelId,
      userId: button.userId,
      content: button.content,
      dueAt: new Date(Date.now() + delay),
    });
    for (const emoji of Object.values(snooze)) {
      await platform.unreact(reaction.channelId, reaction.messageId, emoji).catch(() => {});
    }
    await platform
      .edit(reaction.channelId, reaction.messageId, {
        content: lines(
          copy.deliver(button.userId, button.content, button.createdAt),
          subtext(copy.snoozed(row.dueAt)),
        ),
        mentionUsers: [],
      })
      .catch(() => {});
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
    const messageId = await platform.send(row.channelId, {
      content: lines(
        copy.deliver(row.userId, row.content, row.createdAt),
        subtext(copy.snoozeHint(snooze.soon, snooze.later)),
      ),
      mentionUsers: [row.userId],
    });
    this.#remember(messageId, {
      kind: 'due',
      guildId: row.guildId,
      channelId: row.channelId,
      userId: row.userId,
      content: row.content,
      createdAt: row.createdAt,
    });
    for (const emoji of Object.values(snooze)) {
      await platform.react(row.channelId, messageId, emoji).catch(() => {});
    }
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
