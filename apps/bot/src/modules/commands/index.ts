import definition from '@maxwell/core/modules/commands';
import { CommandStore } from '@maxwell/core/stores/commands';
import { defineBotModule } from '../../runtime/module.js';
import { CommandRunner } from './runner.js';

export default defineBotModule({
  definition,
  setup(ctx) {
    const store = new CommandStore(ctx.services.sql);
    const runner = new CommandRunner(ctx, store);

    ctx.on('message', (message) => runner.handle(message));
    ctx.services.registry.claim((guildId, name) => runner.claims(guildId, name));

    ctx.privacy({
      export: async (guildId, userId) => {
        const lastUsed = await store.lastUsedBy(guildId, userId);
        return lastUsed.length ? { lastUsed } : null;
      },
      forget: (guildId, userId) => store.forgetUser(guildId, userId),
    });

    ctx.job('test', async (job) => {
      const requestId = job.payload.requestId;
      if (!job.guildId || typeof requestId !== 'string' || !requestId || requestId.length > 64) {
        return;
      }
      const result = await runner.test(job.guildId, job.payload);
      await store.saveTest(job.guildId, requestId, result);
    });

    ctx.undo('roles', async (entry, payload) => {
      await runner.undoRoles(entry.guildId, payload);
    });
  },
});
