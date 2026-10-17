import definition from '@maxwell/core/modules/collection';
import { defineBotModule } from '../../runtime/module.js';
import { Wallets } from '../economy/wallets.js';
import { Activity } from './activity.js';
import { collectionCommands } from './commands.js';
import { Drops } from './drops.js';
import { registerCollectionJobs, scheduleDailyRarity } from './jobs.js';
import { Collection } from './service.js';
import { Trades } from './trades.js';

const RARITY_DELAY = 60_000;

export default defineBotModule({
  definition,
  setup(ctx) {
    const schedule = ctx.schedule.bind(ctx);
    const collection = new Collection(ctx.services, new Wallets(ctx.services));
    const activity = new Activity(collection.store, ctx.services.log);
    const drops = new Drops(collection, schedule);
    const trades = new Trades(collection, schedule);

    ctx.on('message', (message) => activity.onMessage(message));
    ctx.on('message', (message) => drops.onMessage(message));
    ctx.on('reaction', (reaction) => trades.onReaction(reaction));
    ctx.on(
      'ready',
      async () => {
        activity.start();
        await trades.load();
        await scheduleDailyRarity(ctx);
      },
      { always: true },
    );
    ctx.onShutdown(() => activity.stop());

    registerCollectionJobs(ctx, collection, drops, trades);
    ctx.privacy({
      export: (guildId, userId) => collection.store.memberData(guildId, userId),
      forget: async (guildId, userId) => {
        activity.forgetMember(guildId, userId);
        await collection.store.forget(guildId, userId);
        collection.invalidate(guildId);
      },
    });

    return collectionCommands({
      collection,
      trades,
      activity,
      refreshRarity: async (guildId) => {
        await ctx.schedule('rarity', {
          guildId,
          runAt: new Date(Date.now() + RARITY_DELAY),
          dedupeKey: `collection.rarity.guild:${guildId}`,
        });
      },
    });
  },
});
