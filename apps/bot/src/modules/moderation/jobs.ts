import { cancel } from '@maxwell/core';
import { generalConfig } from '@maxwell/core/modules/general';
import type { OverwriteChange } from '@maxwell/core/stores/moderation';
import { ShieldStore } from '@maxwell/core/stores/shield';
import { z } from 'zod';
import { statusOf } from './access.js';
import type { AppliedOverwrite, ChannelTools } from './channels.js';
import { expiryKey, NAME_HISTORY_DAYS } from './config.js';
import { reasons } from './copy.js';
import { ActionError, type ModerationService } from './service.js';
import { auditReason } from './text.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const OVERDUE_GRACE = 5 * 60_000;

const snowflake = z.string().regex(/^\d{1,21}$/);

export const actionPayload = z.object({
  action: z.enum(['ban', 'unban', 'kick', 'timeout', 'untimeout', 'warn']),
  userId: snowflake,
  moderatorId: snowflake.nullable().default(null),
  reason: z.string().max(1_500).nullable().default(null),
  durationSeconds: z.number().int().positive().max(63_072_000).nullable().default(null),
  source: z.enum(['dashboard', 'automod', 'security']).default('dashboard'),
  deleteMessageSeconds: z.number().int().min(0).max(604_800).nullable().default(null),
  shield: z.boolean().default(false),
});

export const reviewPayload = z.object({
  number: z.number().int().positive(),
  approve: z.boolean(),
  moderatorId: snowflake.nullable().default(null),
});

export const casePayload = z.object({ number: z.number().int().positive() });

function ignoreMissing(error: unknown): void {
  if (statusOf(error) !== 404) throw error;
}

export function registerJobs(moderation: ModerationService, tools: ChannelTools): void {
  const { ctx, store } = moderation;
  const { platform, log, sql, modules } = ctx.services;

  const scheduleNext = async (kind: string, every: number) => {
    const next = Math.ceil((Date.now() + 1) / every) * every;
    await ctx.schedule(kind, { runAt: new Date(next), dedupeKey: `moderation.${kind}:${next}` });
  };

  ctx.job('expire', async (job) => {
    const guildId = job.guildId;
    const parsed = casePayload.safeParse(job.payload);
    if (!guildId || !parsed.success) return;
    const row = await store.get(guildId, parsed.data.number);
    if (!row || row.endedAt || row.voidedAt || !row.userId) return;
    await store.end(guildId, row.number);
    if (row.action !== 'ban') return;
    moderation.expected.expect(guildId, row.userId, 'unban');
    try {
      await platform.unban(guildId, row.userId, auditReason(reasons.banExpired, null));
    } catch (error) {
      if (statusOf(error) !== 404) {
        log.warn({ err: error, guild: guildId, case: row.number }, 'could not lift expired ban');
      }
    }
    await moderation.act({
      guildId,
      action: 'unban',
      userId: row.userId,
      moderatorId: null,
      reason: reasons.banExpired,
      source: 'system',
      meta: { expired: row.number },
    });
  });

  ctx.job('unlock', async (job) => {
    const guildId = job.guildId;
    const channelId = typeof job.payload.channelId === 'string' ? job.payload.channelId : null;
    if (!guildId || !channelId) return;
    const result = await tools.unlock({
      guildId,
      channelId,
      moderatorId: null,
      reason: reasons.lockExpired,
      record: true,
    });
    if (result.status !== 'unlocked') {
      log.info(
        { guild: guildId, channel: channelId, status: result.status },
        'timed unlock skipped',
      );
    }
  });

  ctx.job('sweep', async () => {
    const overdue = await store.overdue(new Date(Date.now() - OVERDUE_GRACE));
    for (const row of overdue) {
      await ctx.schedule('expire', {
        guildId: row.guildId,
        payload: { number: row.number },
        dedupeKey: expiryKey(row.guildId, row.number),
      });
    }
    await scheduleNext('sweep', HOUR);
  });

  ctx.job('retention', async () => {
    for (const guildId of await store.guildsWithCases()) {
      const general = await modules.get(guildId, 'general', generalConfig);
      if (general.caseRetentionDays === null) continue;
      const removed = await store.deleteBefore(
        guildId,
        new Date(Date.now() - general.caseRetentionDays * DAY),
      );
      if (removed) log.info({ guild: guildId, removed }, 'old cases removed');
    }
    await store.pruneNames(new Date(Date.now() - NAME_HISTORY_DAYS * DAY));
    await scheduleNext('retention', DAY);
  });

  ctx.on(
    'ready',
    async () => {
      await scheduleNext('sweep', HOUR);
      await scheduleNext('retention', DAY);
    },
    { always: true },
  );

  ctx.job('action', async (job) => {
    const guildId = job.guildId;
    const parsed = actionPayload.safeParse(job.payload);
    if (!guildId || !parsed.success) {
      log.warn({ guild: guildId, payload: job.payload }, 'invalid moderation action payload');
      return;
    }
    const input = parsed.data;
    let previousUntil: Date | null = null;
    if (input.action === 'untimeout') {
      const member = await platform.member(guildId, input.userId);
      previousUntil = member?.timeoutUntil ?? null;
    }
    try {
      const result = await moderation.act({
        guildId,
        action: input.action,
        userId: input.userId,
        moderatorId: input.moderatorId,
        reason: input.reason,
        durationMs: input.durationSeconds !== null ? input.durationSeconds * 1_000 : null,
        deleteMessageSeconds: input.deleteMessageSeconds,
        source: input.source,
        previousUntil,
      });
      if (input.shield && result.row.action === 'ban') {
        await new ShieldStore(sql).report(guildId, input.userId, 'manual', input.moderatorId);
      }
    } catch (error) {
      if (error instanceof ActionError && error.status !== null && error.status < 500) {
        log.warn(
          { err: error.original, guild: guildId, action: input.action },
          'dashboard action refused',
        );
        return;
      }
      throw error;
    }
  });

  ctx.job('review', async (job) => {
    const guildId = job.guildId;
    const parsed = reviewPayload.safeParse(job.payload);
    if (!guildId || !parsed.success) return;
    try {
      await moderation.resolveReview(
        guildId,
        parsed.data.number,
        parsed.data.approve,
        parsed.data.moderatorId,
      );
    } catch (error) {
      if (error instanceof ActionError && error.status !== null && error.status < 500) {
        log.warn({ err: error.original, guild: guildId }, 'review action refused');
        return;
      }
      throw error;
    }
  });

  ctx.job('sync', async (job) => {
    const guildId = job.guildId;
    const parsed = casePayload.safeParse(job.payload);
    if (!guildId || !parsed.success) return;
    await moderation.refreshLog(guildId, parsed.data.number);
  });

  const caseOf = (payload: Record<string, unknown>) => ({
    number: Number(payload.number),
    userId: typeof payload.userId === 'string' ? payload.userId : null,
  });
  const header = auditReason(reasons.undone, null);

  ctx.undo('ban', async (entry, payload, by) => {
    const { number, userId } = caseOf(payload);
    if (userId) {
      moderation.expected.expect(entry.guildId, userId, 'unban');
      await platform.unban(entry.guildId, userId, header).catch(ignoreMissing);
    }
    await store.end(entry.guildId, number);
    await cancel(sql, expiryKey(entry.guildId, number));
    await moderation.voidCase(entry.guildId, number, by, reasons.undone);
  });

  ctx.undo('timeout', async (entry, payload, by) => {
    const { number, userId } = caseOf(payload);
    if (userId) {
      moderation.expected.expect(entry.guildId, userId, 'untimeout');
      await platform.timeout(entry.guildId, userId, null, header).catch(ignoreMissing);
    }
    await store.end(entry.guildId, number);
    await cancel(sql, expiryKey(entry.guildId, number));
    await moderation.voidCase(entry.guildId, number, by, reasons.undone);
  });

  for (const kind of ['warn', 'flag'] as const) {
    ctx.undo(kind, async (entry, payload, by) => {
      await moderation.voidCase(entry.guildId, caseOf(payload).number, by, reasons.undone);
    });
  }

  ctx.undo('unban', async (entry, payload, by) => {
    const { number, userId } = caseOf(payload);
    if (userId) {
      moderation.expected.expect(entry.guildId, userId, 'ban');
      await platform.ban(entry.guildId, userId, { reason: header });
    }
    await moderation.voidCase(entry.guildId, number, by, reasons.undone);
  });

  ctx.undo('untimeout', async (entry, payload, by) => {
    const { number, userId } = caseOf(payload);
    const until = typeof payload.until === 'string' ? new Date(payload.until) : null;
    if (userId && until && until.getTime() > Date.now()) {
      moderation.expected.expect(entry.guildId, userId, 'timeout');
      await platform.timeout(entry.guildId, userId, until, header);
    }
    await moderation.voidCase(entry.guildId, number, by, reasons.undone);
  });

  ctx.undo('void', async (entry, payload) => {
    const numbers = Array.isArray(payload.numbers)
      ? payload.numbers.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    await store.unvoid(entry.guildId, numbers);
    for (const number of numbers) await moderation.refreshLog(entry.guildId, number);
  });

  ctx.undo('reason', async (entry, payload) => {
    const number = Number(payload.number);
    const reason = typeof payload.reason === 'string' ? payload.reason : null;
    await store.restoreReason(entry.guildId, number, reason, payload.unclaim === true);
    await moderation.refreshLog(entry.guildId, number);
  });

  ctx.undo('note', async (entry, payload) => {
    await store.deleteNote(entry.guildId, String(payload.id));
  });

  ctx.undo('note.restore', async (entry, payload) => {
    await store.restoreNote(entry.guildId, String(payload.id));
  });

  ctx.undo('lock', async (entry, payload, by) => {
    const channelId = String(payload.channelId);
    await tools.unlock({
      guildId: entry.guildId,
      channelId,
      moderatorId: by.id,
      reason: reasons.undone,
      record: false,
    });
  });

  ctx.undo('unlock', async (entry, payload) => {
    const applied = Array.isArray(payload.applied) ? (payload.applied as AppliedOverwrite[]) : [];
    const lock = Array.isArray(payload.lock) ? (payload.lock as OverwriteChange[]) : null;
    await tools.relock(entry.guildId, String(payload.channelId), applied, lock);
  });

  ctx.undo('slowmode', async (_entry, payload) => {
    const seconds = Number(payload.seconds);
    await tools.restoreSlowmode(String(payload.channelId), Number.isFinite(seconds) ? seconds : 0);
  });
}
