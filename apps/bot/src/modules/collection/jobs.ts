import type { Job } from '@maxwell/core';
import { z } from 'zod';
import type { ModuleContext } from '../../runtime/module.js';
import { auditText, copy } from './copy.js';
import { rarityByActivity } from './draw.js';
import type { Drops } from './drops.js';
import type { Collection } from './service.js';
import type { Trades } from './trades.js';

const ACTIVITY_KEEP_DAYS = 400;
const snowflake = z.string().regex(/^\d{1,21}$/);
const cardId = z.string().regex(/^\d{1,18}$/);
const actor = snowflake.nullable().optional();

export const dropPayload = z.object({
  channelId: snowflake.optional(),
  cardId: cardId.optional(),
  by: actor,
});

export const grantPayload = z.object({
  userId: snowflake,
  cardId,
  count: z.number().int().min(1).max(100).default(1),
  by: actor,
});

const dropExpirePayload = z.object({ dropId: z.string().regex(/^\d+$/) });
const tradeExpirePayload = z.object({ tradeId: z.string().regex(/^\d+$/) });
const undoPayload = z.object({ userId: snowflake, cardId, count: z.number().int().min(1) });

function parse<T extends z.ZodType>(ctx: ModuleContext, schema: T, job: Job): z.output<T> | null {
  const parsed = schema.safeParse(job.payload);
  if (!parsed.success) {
    ctx.services.log.warn({ kind: job.kind, id: job.id }, 'invalid job payload');
    return null;
  }
  return parsed.data;
}

function nextDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 4));
}

export async function recomputeRarity(collection: Collection, guildId: string): Promise<number> {
  const config = await collection.config(guildId);
  const rows = await collection.store.activity(guildId, config.community.activityDays);
  const target = rarityByActivity(rows, config.tiers);
  const updates = rows
    .filter((row) => target.get(row.cardId) !== undefined && target.get(row.cardId) !== row.rarity)
    .map((row) => ({ cardId: row.cardId, rarity: target.get(row.cardId) as string }));
  await collection.store.setRarities(guildId, updates);
  if (updates.length > 0) collection.invalidate(guildId);
  return updates.length;
}

export function scheduleDailyRarity(ctx: ModuleContext): Promise<string | null> {
  const at = nextDay();
  return ctx.schedule('rarity', {
    runAt: at,
    dedupeKey: `collection.rarity:${at.toISOString().slice(0, 10)}`,
  });
}

export function registerCollectionJobs(
  ctx: ModuleContext,
  collection: Collection,
  drops: Drops,
  trades: Trades,
): void {
  const { log } = ctx.services;
  const store = collection.store;

  ctx.job('rarity', async (job) => {
    if (job.guildId) {
      if (await ctx.enabled(job.guildId)) await recomputeRarity(collection, job.guildId);
      return;
    }
    for (const guildId of await store.guildsWithMembers()) {
      if (!(await ctx.enabled(guildId))) continue;
      await recomputeRarity(collection, guildId).catch((error) =>
        log.warn({ err: error, guild: guildId }, 'rarity update failed'),
      );
    }
    await store.pruneActivity(ACTIVITY_KEEP_DAYS);
    await scheduleDailyRarity(ctx);
  });

  ctx.job('drop', async (job) => {
    const data = parse(ctx, dropPayload, job);
    if (!data || !job.guildId) return;
    const config = await collection.config(job.guildId);
    const channelId = data.channelId ?? config.drops.channelIds[0];
    if (!channelId) {
      log.info({ guild: job.guildId }, copy.drop.noChannel);
      return;
    }
    const result = await drops.drop(job.guildId, channelId, data.cardId ?? null, config);
    if (result !== 'sent') {
      log.info({ guild: job.guildId, result }, 'requested drop not sent');
      return;
    }
    const card = data.cardId ? await store.card(job.guildId, data.cardId) : null;
    await ctx.record(
      job.guildId,
      { id: data.by ?? null },
      'collection.drop',
      auditText.dropped(card?.name ?? auditText.someCard),
      {
        after: { channelId, cardId: data.cardId ?? null, number: card?.number ?? null },
      },
    );
  });

  ctx.job('grant', async (job) => {
    const data = parse(ctx, grantPayload, job);
    if (!data || !job.guildId) return;
    const card = await store.card(job.guildId, data.cardId);
    if (!card) return;
    await store.grant(
      job.guildId,
      data.userId,
      Array.from({ length: data.count }, () => card.id),
    );
    await ctx.record(
      job.guildId,
      { id: data.by ?? null },
      'collection.grant',
      auditText.granted(card.name, data.userId, data.count),
      {
        after: { userId: data.userId, cardId: card.id, number: card.number, count: data.count },
        undo: {
          kind: 'revoke',
          payload: { userId: data.userId, cardId: card.id, count: data.count },
        },
      },
    );
  });

  ctx.job('revoke', async (job) => {
    const data = parse(ctx, grantPayload, job);
    if (!data || !job.guildId) return;
    const card = await store.card(job.guildId, data.cardId);
    if (!card) return;
    const taken = await store.revoke(job.guildId, data.userId, card.id, data.count);
    if (taken === 0) return;
    await ctx.record(
      job.guildId,
      { id: data.by ?? null },
      'collection.revoke',
      auditText.revoked(card.name, data.userId, taken),
      {
        after: { userId: data.userId, cardId: card.id, number: card.number, count: taken },
        undo: { kind: 'grant', payload: { userId: data.userId, cardId: card.id, count: taken } },
      },
    );
  });

  ctx.job('dropExpire', async (job) => {
    const data = parse(ctx, dropExpirePayload, job);
    if (data) await drops.expire(data.dropId);
  });

  ctx.job('tradeExpire', async (job) => {
    const data = parse(ctx, tradeExpirePayload, job);
    if (data) await trades.expire(data.tradeId);
  });

  ctx.undo('revoke', async (entry, payload) => {
    const data = undoPayload.parse(payload);
    await store.revoke(entry.guildId, data.userId, data.cardId, data.count);
  });

  ctx.undo('grant', async (entry, payload) => {
    const data = undoPayload.parse(payload);
    if (!(await store.card(entry.guildId, data.cardId))) return;
    await store.grant(
      entry.guildId,
      data.userId,
      Array.from({ length: data.count }, () => data.cardId),
    );
  });
}
