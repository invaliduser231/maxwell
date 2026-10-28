import { type Actor, cancel } from '@maxwell/core';
import {
  defaultDmTemplate,
  dmActions,
  type EscalationStep,
} from '@maxwell/core/modules/moderation';
import type { CaseRow, ModerationStore } from '@maxwell/core/stores/moderation';
import { mention } from '../../commands/mentions.js';
import type { UserRef } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { statusOf } from './access.js';
import type { moderationConfig } from './config.js';
import { type ExecutableAction, expiryKey, type ModerationConfig } from './config.js';
import { copy, reasons } from './copy.js';
import { caseEmbed } from './embeds.js';
import { escalationFor, stepDurationMs } from './escalation.js';
import { type Attribution, AuditHolds, ExpectedActions } from './expected.js';
import { auditReason, clip, humanDuration, renderTemplate } from './text.js';

const DAY = 86_400_000;

export type Source =
  | 'command'
  | 'dashboard'
  | 'escalation'
  | 'external'
  | 'system'
  | 'automod'
  | 'security';

export interface ActInput {
  guildId: string;
  action: ExecutableAction;
  userId: string;
  moderatorId: string | null;
  reason: string | null;
  durationMs?: number | null;
  deleteMessageSeconds?: number | null;
  excerpt?: string | null;
  meta?: Record<string, unknown>;
  source: Source;
  escalate?: boolean;
  previousUntil?: Date | null;
}

export type EscalationResult =
  | { kind: 'acted'; row: CaseRow; step: EscalationStep; active: number; days: number }
  | { kind: 'review'; row: CaseRow; step: EscalationStep; active: number; days: number }
  | { kind: 'failed'; step: EscalationStep; active: number; days: number };

export interface ActResult {
  row: CaseRow;
  user: UserRef | null;
  dm: 'sent' | 'failed' | 'skipped';
  active: number;
  escalation: EscalationResult | null;
}

export class ActionError extends Error {
  constructor(
    readonly status: number | null,
    readonly action: ExecutableAction,
    readonly original: unknown,
  ) {
    super(`moderation action ${action} failed`);
  }
}

type Ctx = ModuleContext<typeof moderationConfig>;

type ReviewListener = (row: CaseRow) => Promise<void>;
type ReviewResolvedListener = (
  guildId: string,
  number: number,
  approved: boolean,
  moderatorId: string | null,
) => Promise<void>;

export class ModerationService {
  readonly expected = new ExpectedActions();
  readonly holds = new AuditHolds();
  readonly #reviewListeners: ReviewListener[] = [];
  readonly #resolvedListeners: ReviewResolvedListener[] = [];

  constructor(
    readonly ctx: Ctx,
    readonly store: ModerationStore,
  ) {}

  get services() {
    return this.ctx.services;
  }

  config(guildId: string): Promise<ModerationConfig> {
    return this.ctx.config(guildId);
  }

  onReview(listener: ReviewListener): void {
    this.#reviewListeners.push(listener);
  }

  onReviewResolved(listener: ReviewResolvedListener): void {
    this.#resolvedListeners.push(listener);
  }

  async #emit<T extends unknown[]>(listeners: ((...args: T) => Promise<void>)[], ...args: T) {
    for (const listener of listeners) {
      await listener(...args).catch((error) =>
        this.services.log.warn({ err: error, module: 'moderation' }, 'review listener failed'),
      );
    }
  }

  async act(input: ActInput): Promise<ActResult> {
    const { platform } = this.services;
    const { guildId, action, userId } = input;
    const config = await this.config(guildId);
    const performed = input.source === 'external' || input.source === 'system';
    const timed = action === 'ban' || action === 'timeout';
    const durationMs =
      action === 'timeout'
        ? (input.durationMs ?? config.defaultTimeoutMinutes * 60_000)
        : timed
          ? (input.durationMs ?? null)
          : null;
    const expiresAt = durationMs !== null ? new Date(Date.now() + durationMs) : null;
    const user = await platform.user(userId);

    let dm: ActResult['dm'] = 'skipped';
    const wantsDm =
      !performed &&
      config.dmMembers &&
      (dmActions as readonly string[]).includes(action) &&
      !user?.bot;

    if (!performed) {
      if (wantsDm && (action === 'ban' || action === 'kick')) {
        dm = await this.#dm(guildId, userId, user, action, input.reason, durationMs, config);
      }
      const moderatorName = input.moderatorId
        ? ((await platform.user(input.moderatorId))?.username ?? null)
        : null;
      const header = auditReason(input.reason ?? reasons.noReason, moderatorName);
      try {
        await this.#perform(input, expiresAt, header, config);
      } catch (error) {
        throw new ActionError(statusOf(error), action, error);
      }
      if (wantsDm && (action === 'warn' || action === 'timeout')) {
        dm = await this.#dm(guildId, userId, user, action, input.reason, durationMs, config);
      }
    }

    if (timed) await this.closeOpen(guildId, userId, action);
    if (action === 'unban') await this.closeOpen(guildId, userId, 'ban');
    if (action === 'untimeout') await this.closeOpen(guildId, userId, 'timeout');

    const meta: Record<string, unknown> = { ...input.meta, source: input.source };
    if (input.source === 'external') meta.external = true;
    if (dm !== 'skipped') meta.dm = dm;
    if (input.previousUntil) meta.previousUntil = input.previousUntil.toISOString();

    const row = await this.store.create({
      guildId,
      action,
      userId,
      moderatorId: input.moderatorId,
      reason: input.reason ? clip(input.reason, 1_500) : null,
      durationSeconds: durationMs !== null ? Math.round(durationMs / 1_000) : null,
      expiresAt,
      excerpt: input.excerpt ? clip(input.excerpt, 1_000) : null,
      meta,
    });

    if (expiresAt) {
      await this.ctx.schedule('expire', {
        guildId,
        payload: { number: row.number },
        runAt: expiresAt,
        dedupeKey: expiryKey(guildId, row.number),
      });
    }

    const name = user ? `@${user.username}` : userId;
    const auditId = await this.ctx.record(
      guildId,
      { id: input.moderatorId },
      `case.${action}`,
      reasons.audit.case(action, row.number, name),
      {
        after: {
          case: row.number,
          userId,
          reason: row.reason,
          durationSeconds: row.durationSeconds,
        },
        undo: undoSpec(row, input.previousUntil ?? null),
      },
    );
    await this.store.setMeta(guildId, row.number, { auditId });
    row.meta = { ...row.meta, auditId };

    await this.postLog(row, user);

    let active = 0;
    let escalation: EscalationResult | null = null;
    if (action === 'warn') {
      active = await this.activeWarnCount(guildId, userId, config);
      if (input.escalate !== false && config.escalationEnabled) {
        escalation = await this.#escalate(guildId, userId, config);
      }
    }
    return { row, user, dm, active, escalation };
  }

  async activeWarnCount(
    guildId: string,
    userId: string,
    config: ModerationConfig,
  ): Promise<number> {
    return (await this.store.activeWarns(guildId, userId, config.warnExpiryDays)).length;
  }

  async closeOpen(guildId: string, userId: string, action: 'ban' | 'timeout'): Promise<void> {
    const open = await this.store.openCase(guildId, userId, action);
    if (!open) return;
    await this.store.end(guildId, open.number);
    await cancel(this.services.sql, expiryKey(guildId, open.number));
  }

  async postLog(row: CaseRow, user: UserRef | null): Promise<void> {
    const { platform, guilds, log } = this.services;
    const config = await this.config(row.guildId);
    if (!config.logChannelId) return;
    const prefix = await guilds.prefix(row.guildId);
    const target = user ?? (row.userId ? await platform.user(row.userId) : null);
    try {
      const messageId = await platform.send(config.logChannelId, {
        embeds: [caseEmbed(row, target, prefix)],
        silent: true,
      });
      await this.store.setLogMessage(row.guildId, row.number, config.logChannelId, messageId);
    } catch (error) {
      log.warn({ err: error, guild: row.guildId, module: 'moderation' }, 'mod log unusable');
    }
  }

  async refreshLog(guildId: string, number: number): Promise<void> {
    const { platform, guilds, log } = this.services;
    const row = await this.store.get(guildId, number);
    if (!row?.logChannelId || !row.logMessageId) return;
    const [prefix, user] = await Promise.all([
      guilds.prefix(guildId),
      row.userId ? platform.user(row.userId) : Promise.resolve(null),
    ]);
    await platform
      .edit(row.logChannelId, row.logMessageId, { embeds: [caseEmbed(row, user, prefix)] })
      .catch((error) =>
        log.debug({ err: error, guild: guildId, case: number }, 'mod log entry not editable'),
      );
  }

  async attribute(guildId: string, number: number, entry: Attribution): Promise<void> {
    const reason = entry.reason ? clip(entry.reason, 1_500) : null;
    if (!(await this.store.attribute(guildId, number, entry.actorId, reason))) return;
    await this.refreshLog(guildId, number);
  }

  async voidCase(
    guildId: string,
    number: number,
    by: Actor,
    reason: string | null,
  ): Promise<boolean> {
    const done = await this.store.voidCase(guildId, number, by.id, reason);
    if (done) await this.refreshLog(guildId, number);
    return done;
  }

  async #perform(
    input: ActInput,
    expiresAt: Date | null,
    header: string,
    config: ModerationConfig,
  ): Promise<void> {
    const { platform } = this.services;
    const { guildId, userId } = input;
    switch (input.action) {
      case 'ban':
        this.expected.expect(guildId, userId, 'ban');
        await platform.ban(guildId, userId, {
          reason: header,
          deleteMessageSeconds: input.deleteMessageSeconds ?? config.banDeleteMessageDays * 86_400,
        });
        return;
      case 'unban':
        this.expected.expect(guildId, userId, 'unban');
        await platform.unban(guildId, userId, header);
        return;
      case 'kick':
        await platform.kick(guildId, userId, header);
        return;
      case 'timeout':
        this.expected.expect(guildId, userId, 'timeout');
        await platform.timeout(guildId, userId, expiresAt, header);
        return;
      case 'untimeout':
        this.expected.expect(guildId, userId, 'untimeout');
        await platform.timeout(guildId, userId, null, header);
        return;
      case 'warn':
      case 'flag':
        return;
    }
  }

  async #dm(
    guildId: string,
    userId: string,
    user: UserRef | null,
    action: ExecutableAction,
    reason: string | null,
    durationMs: number | null,
    config: ModerationConfig,
  ): Promise<'sent' | 'failed' | 'skipped'> {
    if (!config.dmActions.includes(action as (typeof config.dmActions)[number])) return 'skipped';
    const guild = await this.services.platform.guild(guildId);
    const duration = durationMs !== null ? humanDuration(durationMs) : null;
    const verb =
      action === 'ban'
        ? copy.dmAction.ban(duration)
        : action === 'timeout'
          ? copy.dmAction.timeout(duration ?? '')
          : action === 'kick'
            ? copy.dmAction.kick()
            : copy.dmAction.warn();
    const text = renderTemplate(
      config.dmTemplate === defaultDmTemplate ? copy.dmTemplate : config.dmTemplate,
      {
        user: user?.displayName ?? '',
        server: guild?.name ?? '',
        action: verb,
        reason: reason ?? copy.noReason,
        duration: duration ?? copy.permanent,
      },
    );
    const sent = await this.services.platform
      .sendDirect(userId, { content: clip(text, 2_000) })
      .catch(() => false);
    return sent ? 'sent' : 'failed';
  }

  async #escalate(
    guildId: string,
    userId: string,
    config: ModerationConfig,
  ): Promise<EscalationResult | null> {
    const days = config.escalationWindowDays;
    const since = new Date(Date.now() - days * DAY);
    const active = (await this.store.activeWarns(guildId, userId, config.warnExpiryDays, since))
      .length;
    const step = escalationFor(config.escalationSteps, active);
    if (!step) return null;
    const reason = reasons.escalation(active, days);

    if (step.review) {
      const flagged = await this.act({
        guildId,
        action: 'flag',
        userId,
        moderatorId: null,
        reason,
        source: 'escalation',
        meta: { suggested: step.action, durationMinutes: step.durationMinutes, warns: active },
      });
      await this.#emit(this.#reviewListeners, flagged.row);
      return { kind: 'review', row: flagged.row, step, active, days };
    }

    try {
      const result = await this.act({
        guildId,
        action: step.action,
        userId,
        moderatorId: null,
        reason,
        durationMs: stepDurationMs(step),
        source: 'escalation',
      });
      return { kind: 'acted', row: result.row, step, active, days };
    } catch (error) {
      this.services.log.warn(
        { err: error, guild: guildId, user: userId, module: 'moderation' },
        'escalation failed',
      );
      return { kind: 'failed', step, active, days };
    }
  }

  async resolveReview(
    guildId: string,
    number: number,
    approve: boolean,
    moderatorId: string | null,
  ): Promise<ActResult | null> {
    const row = await this.store.get(guildId, number);
    if (row?.action !== 'flag' || row.endedAt || row.voidedAt || !row.userId) return null;
    const by = moderatorId ? mention.user(moderatorId) : copy.maxwell;
    if (!approve) {
      await this.store.setMeta(guildId, number, { review: copy.reviewDeclined(by) });
      await this.store.voidCase(guildId, number, moderatorId, reasons.declined);
      await this.refreshLog(guildId, number);
      await this.#emit(this.#resolvedListeners, guildId, number, false, moderatorId);
      return null;
    }
    const suggested = row.meta.suggested;
    const action = suggested === 'timeout' || suggested === 'kick' ? suggested : 'ban';
    const minutes = typeof row.meta.durationMinutes === 'number' ? row.meta.durationMinutes : null;
    const result = await this.act({
      guildId,
      action,
      userId: row.userId,
      moderatorId,
      reason: row.reason,
      durationMs: minutes !== null ? minutes * 60_000 : null,
      source: 'dashboard',
      meta: { review: number },
    });
    await this.store.end(guildId, number);
    await this.store.setMeta(guildId, number, { review: copy.reviewApproved(by) });
    await this.refreshLog(guildId, number);
    await this.#emit(this.#resolvedListeners, guildId, number, true, moderatorId);
    return result;
  }
}

function undoSpec(
  row: CaseRow,
  previousUntil: Date | null,
): { kind: string; payload: Record<string, unknown> } | null {
  const base = { number: row.number, userId: row.userId };
  switch (row.action) {
    case 'ban':
    case 'unban':
    case 'timeout':
    case 'warn':
    case 'flag':
      return { kind: row.action, payload: base };
    case 'untimeout':
      return previousUntil
        ? { kind: 'untimeout', payload: { ...base, until: previousUntil.toISOString() } }
        : null;
    case 'kick':
      return null;
  }
}
