import definition from '@maxwell/core/modules/giveaways';
import { EconomyStore } from '@maxwell/core/stores/economy';
import { GiveawayStore } from '@maxwell/core/stores/giveaways';
import { defineBotModule } from '../../runtime/module.js';
import { giveawayCommands } from './commands.js';
import { audit } from './copy.js';
import { actorOf, GiveawayRunner, giveawaySpec } from './runner.js';

function idOf(payload: Record<string, unknown>): string | null {
  const id = payload.giveawayId;
  const text = typeof id === 'number' ? String(id) : id;
  return typeof text === 'string' && /^\d{1,19}$/.test(text) ? text : null;
}

export default defineBotModule({
  definition,
  setup(ctx) {
    const { sql, log } = ctx.services;
    const store = new GiveawayStore(sql);
    const runner = new GiveawayRunner(ctx, store, new EconomyStore(sql));

    ctx.on('reaction', (reaction) => runner.onReaction(reaction));
    ctx.on('reactionRemove', (reaction) => runner.onReactionRemove(reaction));
    ctx.on('messageRemove', async (removal) => {
      const cancelled = await runner.onMessageRemove(removal);
      if (cancelled)
        log.info(
          { guild: cancelled.guildId, giveaway: cancelled.id },
          'giveaway message deleted, cancelled',
        );
    });

    ctx.job('start', async (job) => {
      if (!job.guildId) return;
      const id = idOf(job.payload);
      if (id) {
        const giveaway = await store.get(job.guildId, id);
        if (giveaway) await runner.launch(giveaway);
        return;
      }
      const parsed = giveawaySpec.safeParse(job.payload);
      if (!parsed.success) {
        log.warn(
          { guild: job.guildId, job: job.id, issues: parsed.error.issues },
          'invalid giveaway spec',
        );
        return;
      }
      const actor = actorOf(job.payload);
      const created = await runner.create(job.guildId, parsed.data, actor.id);
      if (!created) {
        log.warn({ guild: job.guildId, job: job.id }, 'giveaway times out of range');
        return;
      }
      await runner.launch(created);
      await ctx.record(job.guildId, actor, 'giveaway.start', audit.start(created.prize), {
        after: {
          giveawayId: created.id,
          number: created.number,
          prize: created.prize,
          channelId: created.channelId,
          endsAt: created.endsAt,
        },
        undo: { kind: 'cancel', payload: { giveawayId: created.id } },
      });
    });

    ctx.job('end', async (job) => {
      const id = idOf(job.payload);
      if (!id || !job.guildId) return;
      const giveaway = await store.get(job.guildId, id);
      if (!giveaway) return;
      const ended = await runner.end(id);
      if (ended && typeof job.payload.by === 'string') {
        await ctx.record(
          job.guildId,
          actorOf(job.payload),
          'giveaway.end',
          audit.end(ended.prize),
          {
            after: { giveawayId: id, number: ended.number },
          },
        );
      }
    });

    ctx.job('reroll', async (job) => {
      const id = idOf(job.payload);
      if (!id || !job.guildId) return;
      const giveaway = await store.get(job.guildId, id);
      if (giveaway?.status !== 'ended') return;
      const requested = Number(job.payload.count ?? 1);
      const count = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 20) : 1;
      const winners = await runner.reroll(giveaway, count);
      await ctx.record(
        job.guildId,
        actorOf(job.payload),
        'giveaway.reroll',
        audit.reroll(giveaway.prize, winners.length),
        { after: { giveawayId: id, number: giveaway.number, winners } },
      );
    });

    ctx.job('cancel', async (job) => {
      const id = idOf(job.payload);
      if (!id || !job.guildId) return;
      const giveaway = await store.get(job.guildId, id);
      if (!giveaway) return;
      const cancelled = await runner.cancel(id);
      if (cancelled) {
        await ctx.record(
          job.guildId,
          actorOf(job.payload),
          'giveaway.cancel',
          audit.cancel(cancelled.prize),
          {
            after: { giveawayId: id, number: cancelled.number },
          },
        );
      }
    });

    ctx.undo('cancel', async (entry, payload) => {
      const id = idOf(payload);
      if (!id) return;
      const giveaway = await store.get(entry.guildId, id);
      if (giveaway) await runner.cancel(giveaway.id);
    });

    ctx.privacy({
      async export(guildId, userId) {
        const data = await store.memberData(guildId, userId);
        if (data.entries.length + data.wins.length + data.hosted.length === 0) return null;
        return {
          entries: data.entries.map((entry) => ({
            ...entry,
            enteredAt: entry.enteredAt.toISOString(),
          })),
          wins: data.wins.map((win) => ({ ...win, drawnAt: win.drawnAt.toISOString() })),
          hosted: data.hosted.map((hosted) => ({
            ...hosted,
            createdAt: hosted.createdAt.toISOString(),
          })),
        };
      },
      async forget(guildId, userId) {
        const running = await store.runningEntered(guildId, userId);
        await store.forget(guildId, userId);
        for (const giveaway of running) {
          if (!giveaway.messageId) continue;
          await ctx.services.platform
            .unreact(giveaway.channelId, giveaway.messageId, giveaway.emoji, userId)
            .catch(() => {});
        }
      },
    });

    return giveawayCommands(ctx, store, runner);
  },
});
