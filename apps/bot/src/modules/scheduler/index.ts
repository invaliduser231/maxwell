import definition from '@maxwell/core/modules/scheduler';
import { defineBotModule } from '../../runtime/module.js';
import { schedulerCommands } from './commands.js';
import { changedGuild, keys, SYNC_DELAY } from './config.js';
import { ScheduledMessages } from './messages.js';
import { Reminders } from './reminders.js';

const SWEEP_MS = 6 * 60 * 60_000;

export default defineBotModule({
  definition,
  setup(ctx) {
    const { services } = ctx;
    const messages = new ScheduledMessages(ctx);
    const reminders = new Reminders(ctx);

    const sync = async (guildId: string) => {
      await messages.sync(guildId);
      await reminders.resume(guildId);
    };

    const scheduleSweep = (slot: number) =>
      ctx.schedule('sweep', {
        runAt: new Date(slot * SWEEP_MS),
        dedupeKey: keys.sweep(slot),
      });

    ctx.privacy({
      export: (guildId, userId) => reminders.exportMember(guildId, userId),
      forget: async (guildId, userId) => {
        await reminders.forgetMember(guildId, userId);
      },
    });

    ctx.job('message', (job) => messages.fire(job));
    ctx.job('post', (job) => messages.postNow(job));
    ctx.job('reminder', (job) => reminders.deliver(job));
    ctx.on('reaction', (reaction) => reminders.onReaction(reaction));
    ctx.job('sync', async (job) => {
      if (!job.guildId || !(await ctx.enabled(job.guildId))) return;
      await sync(job.guildId);
    });
    ctx.job('sweep', async () => {
      for (const guildId of services.platform.guildIds()) {
        try {
          if (await ctx.enabled(guildId)) await sync(guildId);
        } catch (error) {
          services.log.warn({ err: error, guild: guildId }, 'scheduler sync failed');
        }
      }
      await scheduleSweep(Math.floor(Date.now() / SWEEP_MS) + 1);
    });

    services.settings.onInvalidate((payload) => {
      const guildId = changedGuild(payload);
      if (!guildId) return;
      ctx
        .schedule('sync', {
          guildId,
          runAt: new Date(Date.now() + SYNC_DELAY),
          dedupeKey: keys.sync(guildId),
        })
        .catch((error) =>
          services.log.warn({ err: error, guild: guildId }, 'scheduler sync not queued'),
        );
    });

    ctx.on(
      'ready',
      async () => {
        const slot = Math.floor(Date.now() / SWEEP_MS);
        await ctx.schedule('sweep', { dedupeKey: keys.sweep(slot) });
        await scheduleSweep(slot + 1);
      },
      { always: true },
    );

    return schedulerCommands(reminders);
  },
});
