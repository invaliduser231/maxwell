import definition from '@maxwell/core/modules/moderation';
import { ModerationStore } from '@maxwell/core/stores/moderation';
import { defineBotModule } from '../../runtime/module.js';
import { ChannelTools } from './channels.js';
import { actionCommands } from './commands/actions.js';
import { caseCommands } from './commands/cases.js';
import { channelCommands } from './commands/channels.js';
import { massBanCommand } from './commands/massban.js';
import { noteCommands } from './commands/notes.js';
import { reportCommands } from './commands/report.js';
import { Confirmations } from './confirm.js';
import { registerEvents } from './events.js';
import { ModInbox } from './inbox.js';
import { registerInbox } from './inbox-jobs.js';
import { registerJobs } from './jobs.js';
import { NameTracker } from './names.js';
import { exportInbox, exportMember } from './privacy.js';
import { ModerationService } from './service.js';

export default defineBotModule({
  definition,
  setup(ctx) {
    const store = new ModerationStore(ctx.services.sql);
    const moderation = new ModerationService(ctx, store);
    const tools = new ChannelTools(moderation);
    const names = new NameTracker(store);
    const confirmations = new Confirmations();
    const inbox = new ModInbox(moderation);

    registerJobs(moderation, tools);
    registerEvents(moderation, names, confirmations);
    registerInbox(inbox);
    ctx.onShutdown(() => confirmations.stop());
    ctx.privacy({
      export: async (guildId, userId) => {
        const [cases, reports] = await Promise.all([
          exportMember(store, guildId, userId),
          exportInbox(inbox.store, guildId, userId),
        ]);
        return cases || reports ? { ...cases, ...(reports ? { inbox: reports } : {}) } : null;
      },
      forget: async (guildId, userId) => {
        await store.forgetMember(guildId, userId);
        await inbox.store.forget(guildId, userId);
        names.forget(guildId, userId);
      },
    });

    return [
      ...actionCommands(moderation),
      massBanCommand(moderation, confirmations),
      ...caseCommands(moderation),
      ...noteCommands(moderation),
      ...reportCommands(inbox),
      ...channelCommands(tools, confirmations),
    ];
  },
});
