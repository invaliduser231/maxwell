import definition from '@maxwell/core/modules/insights';
import { InsightsStore } from '@maxwell/core/stores/insights';
import { defineBotModule } from '../../runtime/module.js';
import { InsightsCollector } from './collector.js';
import { nextSlot } from './recurring.js';

const FLUSH = 60_000;
const PRUNE = 24 * 60 * 60 * 1000;

export default defineBotModule({
  definition,
  setup(ctx) {
    const { sql, log } = ctx.services;
    const store = new InsightsStore(sql);
    const collector = new InsightsCollector(ctx, store);

    const scheduleFlush = () => ctx.schedule('flush', nextSlot('insights.flush', FLUSH));
    const schedulePrune = () => ctx.schedule('prune', nextSlot('insights.prune', PRUNE));

    ctx.on('message', (message) => collector.onMessage(message));
    ctx.on('memberJoin', (join) => collector.onJoin(join.guildId));
    ctx.on('memberLeave', (leave) => collector.onLeave(leave.guildId));
    ctx.on('auditLog', (entry) => collector.onAudit(entry));
    ctx.on('voiceUpdate', (change) => collector.onVoice(change), { always: true });
    ctx.on(
      'ready',
      async () => {
        collector.sessions.clear();
        await Promise.all([scheduleFlush(), schedulePrune()]);
      },
      { always: true },
    );

    ctx.privacy({
      export: async (guildId, userId) => {
        const data = await collector.export(guildId, userId);
        return data ? { ...data } : null;
      },
      forget: (guildId, userId) => collector.forget(guildId, userId),
    });

    ctx.job('flush', async () => {
      await scheduleFlush();
      const rows = await collector.flush();
      if (rows) log.debug({ rows }, 'insights flushed');
    });

    ctx.job('prune', async () => {
      await schedulePrune();
      const removed = await store.prune();
      if (removed) log.info({ removed }, 'insights pruned');
    });

    ctx.onShutdown(async () => {
      await collector.flush();
    });
  },
});
