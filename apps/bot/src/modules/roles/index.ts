import definition from '@maxwell/core/modules/roles';
import { RolesStore } from '@maxwell/core/stores/roles';
import { defineBotModule } from '../../runtime/module.js';
import { AutomodHolds } from './held.js';
import { Members } from './members.js';
import { Menus } from './menus.js';
import { rolesPrivacy } from './privacy.js';

function actorOf(payload: Record<string, unknown>): { id: string | null } {
  return { id: typeof payload.by === 'string' ? payload.by : null };
}

export default defineBotModule({
  definition,
  setup(ctx) {
    const { services } = ctx;
    const store = new RolesStore(services.sql);
    const holds = new AutomodHolds(services.sql, services.settings, services.log);
    const menus = new Menus(ctx, store);
    const members = new Members(ctx, store, holds);

    ctx.on('reaction', (reaction) => menus.onReaction(reaction, true));
    ctx.on('reactionRemove', (reaction) => menus.onReaction(reaction, false));
    ctx.on('messageRemove', (removal) => menus.onMessageRemove(removal.id));
    ctx.on('memberJoin', (join) => members.onJoin(join));
    ctx.on('memberLeave', (leave) => members.onLeave(leave));
    ctx.on('memberUpdate', (update) => members.onUpdate(update));
    ctx.on('message', (message) => members.onMessage(message));
    ctx.on('ready', () => members.seedSweeps(), { always: true });

    ctx.job('menu.publish', async (job) => {
      const menuId = job.payload.menuId;
      if (!job.guildId || typeof menuId !== 'string') return;
      await menus.publish(job.guildId, menuId, actorOf(job.payload));
    });

    ctx.job('menu.remove', async (job) => {
      const menuId = job.payload.menuId;
      if (!job.guildId || typeof menuId !== 'string') return;
      await menus.remove(job.guildId, menuId, actorOf(job.payload));
    });

    ctx.job('temp.expire', (job) => menus.expire(job));
    ctx.job('auto.grant', (job) => members.grantDelayed(job));
    ctx.job('sticky.restore', (job) => members.restoreDelayed(job));

    ctx.job('time.sweep', (job) => members.sweep(job));

    ctx.undo('menu.unpublish', async (entry, payload) => {
      const { menuId, channelId, messageId } = payload;
      if (typeof menuId !== 'string' || typeof channelId !== 'string') return;
      if (typeof messageId !== 'string') return;
      await menus.unpublish(entry.guildId, menuId, channelId, messageId);
    });

    ctx.undo('sticky.revert', async (entry, payload) => {
      const { userId, roleIds } = payload;
      if (typeof userId !== 'string' || !Array.isArray(roleIds)) return;
      await members.revertSticky(entry.guildId, userId, roleIds.map(String));
    });

    ctx.privacy(rolesPrivacy(store, members));
  },
});
