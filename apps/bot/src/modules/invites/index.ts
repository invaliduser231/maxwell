import invites from '@maxwell/core/modules/invites';
import { defineBotModule } from '../../runtime/module.js';
import { inviteCommands } from './commands.js';
import { InviteStore } from './store.js';
import { InviteTracker } from './tracker.js';

export default defineBotModule({
  definition: invites,
  setup(ctx) {
    const store = new InviteStore(ctx.services.sql);
    const tracker = new InviteTracker(ctx.services, store);

    ctx.on('memberJoin', (join) => tracker.onJoin(join));
    ctx.on('memberLeave', ({ guildId, userId }) => tracker.onLeave(guildId, userId), {
      always: true,
    });
    ctx.on('ready', () => tracker.reconcile(), { always: true });
    ctx.onShutdown(() => tracker.stop());
    ctx.privacy({
      export: (guildId, userId) => store.memberData(guildId, userId),
      forget: (guildId, userId) => store.forget(guildId, userId),
    });

    return [inviteCommands(store)];
  },
});
