import definition from '@maxwell/core/modules/starboard';
import { StarboardStore } from '@maxwell/core/stores/starboard';
import { defineBotModule } from '../../runtime/module.js';
import { Starboard } from './board.js';

export default defineBotModule({
  definition,
  setup(ctx) {
    const store = new StarboardStore(ctx.services.sql);
    const board = new Starboard(ctx, store);

    ctx.on('reaction', (reaction) => board.onReaction(reaction));
    ctx.on('reactionRemove', (reaction) => board.onReaction(reaction));
    ctx.on('messageRemove', (removal) =>
      removal.guildId
        ? board.onMessageRemove(removal.guildId, removal.channelId, removal.id)
        : undefined,
    );
    ctx.on('messageBulkRemove', async (removal) => {
      if (!removal.guildId) return;
      for (const id of removal.ids.slice(0, 200)) {
        await board.onMessageRemove(removal.guildId, removal.channelId, id);
      }
    });
    ctx.on('channelUpdate', ({ channel }) => board.noteChannel(channel), { always: true });
    ctx.on('channelDelete', ({ channel }) => board.forgetChannel(channel.id), { always: true });

    ctx.job('sync', (job) => board.sync(job));

    ctx.privacy(board.privacy());
  },
});
