import definition from '@maxwell/core/modules/economy';
import { defineBotModule } from '../../runtime/module.js';
import { economyCommands } from './commands.js';
import { Earnings } from './earnings.js';
import { registerEconomyJobs } from './jobs.js';
import { Shop } from './shop.js';
import { Wallets } from './wallets.js';

export default defineBotModule({
  definition,
  setup(ctx) {
    const wallets = new Wallets(ctx.services);
    const earnings = new Earnings(ctx.services, wallets);
    const shop = new Shop(ctx.services, wallets, (kind, input) => ctx.schedule(kind, input));

    ctx.on('message', (message) => earnings.onMessage(message));
    registerEconomyJobs(ctx, wallets);
    ctx.privacy({
      export: (guildId, userId) => wallets.store.memberData(guildId, userId),
      forget: (guildId, userId) => wallets.store.forget(guildId, userId),
    });

    return economyCommands(wallets, shop);
  },
});
