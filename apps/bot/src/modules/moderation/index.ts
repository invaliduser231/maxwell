import definition from '@maxwell/core/modules/moderation';
import { ModerationStore } from '@maxwell/core/stores/moderation';
import { defineBotModule } from '../../runtime/module.js';
import { ChannelTools } from './channels.js';
import { actionCommands } from './commands/actions.js';
import { caseCommands } from './commands/cases.js';
import { channelCommands } from './commands/channels.js';
import { noteCommands } from './commands/notes.js';
import { Confirmations } from './confirm.js';
import { registerEvents } from './events.js';
import { registerJobs } from './jobs.js';
import { NameTracker } from './names.js';
import { exportMember } from './privacy.js';
import { ModerationService } from './service.js';

export default defineBotModule({
  definition,
  setup(ctx) {
    const store = new ModerationStore(ctx.services.sql);
    const moderation = new ModerationService(ctx, store);
    const tools = new ChannelTools(moderation);
    const names = new NameTracker(store);
    const confirmations = new Confirmations();

    registerJobs(moderation, tools);
    registerEvents(moderation, names, confirmations);
    ctx.onShutdown(() => confirmations.stop());
    ctx.privacy({
      export: (guildId, userId) => exportMember(store, guildId, userId),
      forget: async (guildId, userId) => {
        await store.forgetMember(guildId, userId);
        names.forget(guildId, userId);
      },
    });

    return [
      ...actionCommands(moderation),
      ...caseCommands(moderation),
      ...noteCommands(moderation),
      ...channelCommands(tools, confirmations),
    ];
  },
});
