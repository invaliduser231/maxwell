import { type Job, UNDO_WINDOW_MS } from '@maxwell/core';
import { DAY_MS } from '@maxwell/core/stores/economy';
import { z } from 'zod';
import type { ModuleContext } from '../../runtime/module.js';
import { auditText, copy } from './copy.js';
import type { Wallets } from './wallets.js';

const snowflake = z.string().regex(/^\d{1,21}$/);
const actor = snowflake.nullable().optional();

export const adjustPayload = z.object({
  userId: snowflake,
  amount: z
    .number()
    .int()
    .refine((n) => n !== 0),
  note: z.string().max(200).nullable().optional(),
  by: actor,
});

export const rewardPayload = z.object({
  userIds: z.array(snowflake).min(1).max(1_000),
  amount: z.number().int().min(1).optional(),
  reason: z.string().max(200).nullable().optional(),
  by: actor,
});

export const refundPayload = z.object({ purchaseId: z.string().regex(/^\d+$/), by: actor });

export const restockPayload = z.object({
  itemId: z.string().min(1).max(32),
  sold: z.number().int().min(0).default(0),
  by: actor,
});

export const resetPayload = z.object({ by: actor });

const roleExpirePayload = z.object({
  userId: snowflake,
  roleId: snowflake,
  purchaseId: z.string().optional(),
});

const undoAdjust = z.object({ userId: snowflake, amount: z.number().int() });
const undoReward = z.object({
  entries: z.array(z.object({ userId: snowflake, amount: z.number().int() })),
});
const undoRestock = z.object({ itemId: z.string(), sold: z.number().int().min(0) });
const undoReset = z.object({ resetId: z.string().regex(/^\d+$/) });

function parse<T extends z.ZodType>(
  ctx: ModuleContext,
  schema: T,
  job: Job,
): { guildId: string; data: z.output<T> } | null {
  const parsed = schema.safeParse(job.payload);
  if (!job.guildId || !parsed.success) {
    ctx.services.log.warn({ kind: job.kind, id: job.id }, 'invalid job payload');
    return null;
  }
  return { guildId: job.guildId, data: parsed.data };
}

export function registerEconomyJobs(ctx: ModuleContext, wallets: Wallets): void {
  const store = wallets.store;
  const { platform, log } = ctx.services;

  ctx.job('adjust', async (job) => {
    const input = parse(ctx, adjustPayload, job);
    if (!input) return;
    const { guildId, data } = input;
    const config = await wallets.config(guildId);
    await wallets.ensure(guildId, data.userId, config);
    const { applied } = await store.adjust(guildId, data.userId, data.amount, 'admin', {
      note: data.note ?? null,
      counterpartId: data.by ?? null,
    });
    if (applied === 0) return;
    await ctx.record(
      guildId,
      { id: data.by ?? null },
      'economy.adjust',
      applied > 0
        ? auditText.gave(applied, data.userId, config.currency)
        : auditText.took(-applied, data.userId, config.currency),
      {
        after: { userId: data.userId, amount: applied },
        undo: { kind: 'adjust', payload: { userId: data.userId, amount: -applied } },
      },
    );
  });

  ctx.job('reward', async (job) => {
    const input = parse(ctx, rewardPayload, job);
    if (!input) return;
    const { guildId, data } = input;
    const config = await wallets.config(guildId);
    const amount = data.amount ?? config.rewards.event;
    const entries: { userId: string; amount: number }[] = [];
    for (const userId of new Set(data.userIds)) {
      await wallets.ensure(guildId, userId, config);
      const { credited } = await store.earn(guildId, userId, amount, 'event', config.dailyCap, {
        note: data.reason ?? null,
      });
      if (credited > 0) entries.push({ userId, amount: credited });
    }
    if (entries.length === 0) return;
    await ctx.record(
      guildId,
      { id: data.by ?? null },
      'economy.reward',
      auditText.rewarded(entries.length, amount, config.currency),
      {
        after: { entries, reason: data.reason ?? null },
        undo: { kind: 'reward', payload: { entries } },
      },
    );
  });

  ctx.job('refund', async (job) => {
    const input = parse(ctx, refundPayload, job);
    if (!input) return;
    const { guildId, data } = input;
    const config = await wallets.config(guildId);
    const purchase = await store.findPurchase(guildId, data.purchaseId);
    if (!purchase) return;
    const refunded = await store.refund(guildId, data.purchaseId, purchase.kind !== 'role');
    if (!refunded) return;
    if (refunded.kind === 'role' && refunded.ref) {
      await platform
        .removeRole(guildId, refunded.userId, refunded.ref, copy.reasons.refunded)
        .catch((error) => log.warn({ err: error, guild: guildId }, 'refund role removal failed'));
    }
    if (refunded.kind === 'background' && refunded.ref) {
      const current = await store.background(guildId, refunded.userId);
      if (current === refunded.ref) await store.setBackground(guildId, refunded.userId, null);
    }
    const name = config.shop.find((item) => item.id === refunded.itemId)?.name ?? refunded.itemId;
    await ctx.record(
      guildId,
      { id: data.by ?? null },
      'economy.refund',
      auditText.refunded(name, refunded.userId),
      { after: { purchaseId: refunded.id, userId: refunded.userId, price: refunded.price } },
    );
  });

  ctx.job('restock', async (job) => {
    const input = parse(ctx, restockPayload, job);
    if (!input) return;
    const { guildId, data } = input;
    const config = await wallets.config(guildId);
    const before = await store.setSold(guildId, data.itemId, data.sold);
    const name = config.shop.find((item) => item.id === data.itemId)?.name ?? data.itemId;
    await ctx.record(
      guildId,
      { id: data.by ?? null },
      'economy.restock',
      auditText.restocked(name),
      {
        before: { sold: before },
        after: { sold: data.sold },
        undo: { kind: 'restock', payload: { itemId: data.itemId, sold: before } },
      },
    );
  });

  ctx.job('reset', async (job) => {
    const input = parse(ctx, resetPayload, job);
    if (!input) return;
    const { guildId, data } = input;
    const config = await wallets.config(guildId);
    await store.pruneResets(guildId, new Date(Date.now() - UNDO_WINDOW_MS - DAY_MS));
    const reset = await store.reset(guildId);
    if (!reset) return;
    await ctx.record(
      guildId,
      { id: data.by ?? null },
      'economy.reset',
      auditText.reset(reset.members, reset.total, config.currency),
      {
        before: { members: reset.members, total: reset.total },
        undo: { kind: 'reset', payload: { resetId: reset.id } },
      },
    );
  });

  ctx.job('roleExpire', async (job) => {
    const input = parse(ctx, roleExpirePayload, job);
    if (!input) return;
    const { guildId, data } = input;
    await platform
      .removeRole(guildId, data.userId, data.roleId, copy.reasons.expired)
      .catch((error) => log.warn({ err: error, guild: guildId }, 'shop role removal failed'));
  });

  ctx.undo('adjust', async (entry, payload) => {
    const data = undoAdjust.parse(payload);
    await store.adjust(entry.guildId, data.userId, data.amount, 'undo', { ref: entry.id });
  });

  ctx.undo('reward', async (entry, payload) => {
    const data = undoReward.parse(payload);
    for (const item of data.entries) {
      await store.adjust(entry.guildId, item.userId, -item.amount, 'undo', { ref: entry.id });
    }
  });

  ctx.undo('reset', async (entry, payload) => {
    const data = undoReset.parse(payload);
    await store.restoreReset(entry.guildId, data.resetId);
  });

  ctx.undo('restock', async (entry, payload) => {
    const data = undoRestock.parse(payload);
    await store.setSold(entry.guildId, data.itemId, data.sold);
  });
}
