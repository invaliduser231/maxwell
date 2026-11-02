import definition from '@maxwell/core/modules/roles';
import { RolesStore } from '@maxwell/core/stores/roles';
import { defineBotModule } from '../../runtime/module.js';
import { nextSlot } from '../insights/recurring.js';
import { ActivityRoles } from './activity.js';
import { AutomodHolds } from './held.js';
import { Members } from './members.js';
import { Menus } from './menus.js';
import { rolesPrivacy } from './privacy.js';

const FLUSH = 5 * 60_000;

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
    const activity = new ActivityRoles(ctx, store, holds);
    const members = new Members(ctx, store, holds, activity);

    ctx.on('reaction', (reaction) => menus.onReaction(reaction, true));
    ctx.on('reactionRemove', (reaction) => menus.onReaction(reaction, false));
    ctx.on('ownReactionRemove', (reaction) => menus.onOwnReactionRemove(reaction));
    ctx.on('messageRemove', (removal) => menus.onMessageRemove(removal.id));
    ctx.on('roleDelete', (change) => menus.onRoleDelete(change.guildId, change.roleId));
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
    ctx.job('activity.flush', async () => {
      try {
        await activity.flush();
      } finally {
        await ctx.schedule('activity.flush', nextSlot('roles.activity.flush', FLUSH));
      }
    });
    ctx.on(
      'ready',
      async () => {
        await ctx.schedule('activity.flush', nextSlot('roles.activity.flush', FLUSH));
      },
      { always: true },
    );
    ctx.onShutdown(async () => {
      await activity.flush();
    });

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
