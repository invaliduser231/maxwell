import type { Job } from '@maxwell/core';
import { z } from 'zod';
import type { ModuleContext } from '../../runtime/module.js';
import type { Blackjack } from './blackjack.js';
import type { Coinflip } from './coinflip.js';
import { auditText, gameNames } from './copy.js';
import type { HigherLower } from './hilo.js';
import type { Games } from './service.js';
import type { Trivia } from './trivia.js';

const snowflake = z.string().regex(/^\d{1,21}$/);

export const resetPayload = z.object({
  game: z.enum(['counting', 'wordchain']),
  channelId: snowflake.optional(),
  by: snowflake.nullable().optional(),
});

const triviaEndPayload = z.object({ channelId: snowflake, sessionId: z.string().min(1) });
const hiloExpirePayload = z.object({ userId: snowflake });
const duelExpirePayload = z.object({ duelId: z.string().regex(/^\d+$/) });
const restorePayload = z.object({
  game: z.enum(['counting', 'wordchain']),
  channelId: snowflake,
  state: z.object({
    current: z.number().int(),
    lastWord: z.string().nullable(),
    lastUser: z.string().nullable(),
    highScore: z.number().int(),
  }),
});

function parse<T extends z.ZodType>(ctx: ModuleContext, schema: T, job: Job): z.output<T> | null {
  const parsed = schema.safeParse(job.payload);
  if (!parsed.success) {
    ctx.services.log.warn({ kind: job.kind, id: job.id }, 'invalid job payload');
    return null;
  }
  return parsed.data;
}

export function registerGamesJobs(
  ctx: ModuleContext,
  games: Games,
  trivia: Trivia,
  hilo: HigherLower,
  coinflip: Coinflip,
  blackjack: Blackjack,
): void {
  ctx.job('triviaEnd', async (job) => {
    const data = parse(ctx, triviaEndPayload, job);
    if (data) await trivia.end(data.channelId, data.sessionId);
  });

  ctx.job('hiloExpire', async (job) => {
    const data = parse(ctx, hiloExpirePayload, job);
    if (data && job.guildId) await hilo.expire(job.guildId, data.userId);
  });

  ctx.job('blackjackExpire', async (job) => {
    const data = parse(ctx, hiloExpirePayload, job);
    if (data && job.guildId) await blackjack.expire(job.guildId, data.userId);
  });

  ctx.job('duelExpire', async (job) => {
    const data = parse(ctx, duelExpirePayload, job);
    if (data && job.guildId) await coinflip.expire(job.guildId, data.duelId);
  });

  ctx.job('resetChannel', async (job) => {
    const data = parse(ctx, resetPayload, job);
    if (!data || !job.guildId) return;
    const config = await games.config(job.guildId);
    const channelId = data.channelId ?? config[data.game].channelId;
    if (!channelId) return;
    const before = await games.store.resetChannel(job.guildId, channelId, data.game);
    if (!before) return;
    await ctx.record(
      job.guildId,
      { id: data.by ?? null },
      'games.reset',
      auditText.reset(gameNames[data.game]),
      {
        before,
        undo: { kind: 'restoreChannel', payload: { game: data.game, channelId, state: before } },
      },
    );
  });

  ctx.undo('restoreChannel', async (entry, payload) => {
    const data = restorePayload.parse(payload);
    await games.store.restoreChannel(entry.guildId, data.channelId, data.game, data.state);
  });
}
