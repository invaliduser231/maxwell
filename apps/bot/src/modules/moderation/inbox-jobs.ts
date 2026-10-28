import { z } from 'zod';
import { assignPayload, type ModInbox, resolvePayload } from './inbox.js';

const notifyPayload = z.object({ number: z.number().int().positive() });

export function registerInbox(inbox: ModInbox): void {
  const { ctx } = inbox.moderation;
  const { log } = ctx.services;

  ctx.on('reaction', (reaction) => inbox.onReaction(reaction));

  ctx.job('inbox.assign', async (job) => {
    const parsed = assignPayload.safeParse(job.payload);
    if (!job.guildId || !parsed.success) {
      log.warn({ guild: job.guildId, job: job.id }, 'invalid inbox assign payload');
      return;
    }
    const { number, assigneeId, by } = parsed.data;
    await inbox.assign(job.guildId, number, assigneeId, by);
  });

  ctx.job('inbox.resolve', async (job) => {
    const parsed = resolvePayload.safeParse(job.payload);
    if (!job.guildId || !parsed.success) {
      log.warn({ guild: job.guildId, job: job.id }, 'invalid inbox resolve payload');
      return;
    }
    await inbox.resolve(job.guildId, parsed.data);
  });

  ctx.job('inbox.notify', async (job) => {
    const parsed = notifyPayload.safeParse(job.payload);
    if (!job.guildId || !parsed.success) return;
    await inbox.notifyNumber(job.guildId, parsed.data.number);
  });

  ctx.undo('inbox', async (entry, payload, by) => {
    await inbox.restore(entry.guildId, payload, by);
  });
}
