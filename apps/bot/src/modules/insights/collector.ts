import type { insightsConfig, NativeAction } from '@maxwell/core/modules/insights';
import type { InsightsStore, MemberInsights } from '@maxwell/core/stores/insights';
import {
  AuditAction,
  type AuditLogEvent,
  type IncomingMessage,
  type VoiceChange,
} from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { type Accrual, InsightsBuffer, VoiceSessions } from './buffer.js';

type Ctx = ModuleContext<typeof insightsConfig>;

const STALE_FLUSH = 3 * 60_000;

export function nativeAction(entry: AuditLogEvent, selfId: string | null): NativeAction | null {
  if (selfId && entry.actorId === selfId) return null;
  if (entry.action === AuditAction.MemberBanAdd) return 'ban';
  if (entry.action === AuditAction.MemberKick) return 'kick';
  return null;
}

export class InsightsCollector {
  readonly buffer: InsightsBuffer;
  readonly sessions = new VoiceSessions();
  #flushing: Promise<number> | null = null;
  #lastFlush: number;

  constructor(
    private readonly ctx: Ctx,
    private readonly store: InsightsStore,
    limit = 50_000,
    private readonly now: () => number = Date.now,
  ) {
    this.buffer = new InsightsBuffer(limit);
    this.#lastFlush = now();
  }

  #maybeFlush(): void {
    const overdue = this.now() - this.#lastFlush > STALE_FLUSH;
    if (this.buffer.size() >= this.buffer.limit || overdue) void this.flush();
  }

  async onMessage(message: IncomingMessage): Promise<void> {
    const guildId = message.guildId;
    if (!guildId || message.fromWebhook) return;
    const config = await this.ctx.config(guildId);
    if (message.author.bot && !config.countBots) return;
    if (config.excludedChannels.includes(message.channelId)) return;
    this.buffer.message(guildId, message.channelId, message.author.id, message.createdAt);
    this.#maybeFlush();
  }

  onJoin(guildId: string): void {
    this.buffer.member(guildId, new Date(this.now()), 1, 0);
    this.#maybeFlush();
  }

  onLeave(guildId: string): void {
    this.buffer.member(guildId, new Date(this.now()), 0, 1);
    this.#maybeFlush();
  }

  onAudit(entry: AuditLogEvent): void {
    const action = nativeAction(entry, this.ctx.services.platform.selfId);
    if (!action) return;
    this.buffer.moderation(entry.guildId, new Date(this.now()), action, entry.actorId);
    this.#maybeFlush();
  }

  async export(guildId: string, userId: string): Promise<MemberInsights | null> {
    await this.flush();
    const data = await this.store.member(guildId, userId);
    return data.activity.length || data.moderation.length ? data : null;
  }

  async forget(guildId: string, userId: string): Promise<void> {
    await this.flush();
    this.buffer.forget(guildId, userId);
    await this.store.forgetUser(guildId, userId);
  }

  async #keep(accruals: readonly Accrual[]): Promise<void> {
    if (accruals.length === 0) return;
    const verdict = new Map<string, boolean>();
    for (const accrual of accruals) {
      let keep = verdict.get(accrual.guildId);
      if (keep === undefined) {
        keep =
          (await this.ctx.enabled(accrual.guildId)) &&
          (await this.ctx.config(accrual.guildId)).trackVoice;
        verdict.set(accrual.guildId, keep);
      }
      if (keep) this.buffer.voice(accrual);
    }
  }

  async onVoice(change: VoiceChange): Promise<void> {
    if (change.userId === this.ctx.services.platform.selfId) return;
    const accruals = this.sessions.update(
      change.guildId,
      change.userId,
      change.channelId,
      this.now(),
    );
    await this.#keep(accruals);
  }

  flush(): Promise<number> {
    if (this.#flushing) return this.#flushing;
    this.#flushing = this.#flush().finally(() => {
      this.#flushing = null;
    });
    return this.#flushing;
  }

  async #flush(): Promise<number> {
    this.#lastFlush = this.now();
    await this.#keep(this.sessions.settle(this.now()));
    const batch = this.buffer.drain();
    const rows =
      batch.messages.length +
      batch.active.length +
      batch.members.length +
      batch.voice.length +
      (batch.moderation?.length ?? 0);
    if (rows === 0) return 0;
    try {
      return await this.store.write(batch);
    } catch (error) {
      const kept = this.buffer.restore(batch);
      this.ctx.services.log.warn({ err: error, rows, kept }, 'insights flush failed');
      return 0;
    }
  }
}
