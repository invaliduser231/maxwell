import definition from '@maxwell/core/modules/welcome';
import { WelcomeStore } from '@maxwell/core/stores/welcome';
import { defineBotModule } from '../../runtime/module.js';
import { AutomodHolds } from '../roles/held.js';
import { RulesGate, welcomePrivacy } from './gate.js';
import { Greeter, type GreetingKind } from './greeter.js';

const kinds: readonly GreetingKind[] = ['join', 'leave', 'dm'];

export default defineBotModule({
  definition,
  setup(ctx) {
    const { services } = ctx;
    const store = new WelcomeStore(services.sql);
    const greeter = new Greeter(services);
    const gate = new RulesGate(
      ctx,
      store,
      new AutomodHolds(services.sql, services.settings, services.log),
    );

    ctx.on('memberJoin', async (join) => {
      const config = await ctx.config(join.guildId);
      if (config.ignoreBots && join.user.bot) return;
      await Promise.all([
        greeter.onJoin(join, config),
        gate.onJoin(join.guildId, join.user.id, config, join.joinedAt.getTime()),
      ]);
    });

    ctx.on('memberLeave', async (leave) => {
      await greeter.onLeave(leave, await ctx.config(leave.guildId));
    });

    ctx.on('memberUpdate', (update) => gate.onMemberUpdate(update));

    ctx.on('reaction', async (reaction) => {
      if (!reaction.guildId || reaction.bot) return;
      await gate.onReaction(reaction, await ctx.config(reaction.guildId), true);
    });

    ctx.on('reactionRemove', async (reaction) => {
      if (!reaction.guildId || reaction.bot) return;
      await gate.onReaction(reaction, await ctx.config(reaction.guildId), false);
    });

    ctx.on('messageRemove', async (removal) => {
      if (!removal.guildId) return;
      const config = await ctx.config(removal.guildId);
      if (config.rules.messageId) return;
      if ((await gate.messageId(removal.guildId, config)) !== removal.id) return;
      await store.clearRulesMessage(removal.guildId, removal.id);
      gate.forget(removal.guildId);
    });

    ctx.job('roles.grant', (job) => gate.grantDelayed(job));
    ctx.job('rules.restore', (job) => gate.restoreJob(job));

    ctx.job('rules.publish', async (job) => {
      if (!job.guildId) return;
      const by = typeof job.payload.by === 'string' ? job.payload.by : null;
      await gate.publish(job.guildId, { id: by });
    });

    ctx.job('rules.remove', async (job) => {
      if (!job.guildId) return;
      const by = typeof job.payload.by === 'string' ? job.payload.by : null;
      await gate.remove(job.guildId, { id: by });
    });

    ctx.job('preview', async (job) => {
      const guildId = job.guildId;
      const { userId, kind } = job.payload as { userId?: string; kind?: GreetingKind };
      if (!guildId || !userId || !kind || !kinds.includes(kind)) return;
      const config = await ctx.config(guildId);
      const [user, guild] = await Promise.all([
        services.platform.user(userId),
        services.platform.guild(guildId),
      ]);
      if (!user) return;
      const channelId =
        kind === 'join'
          ? (config.join.channelId ?? undefined)
          : kind === 'leave'
            ? (config.leave.channelId ?? undefined)
            : undefined;
      await greeter.greet(kind, guildId, user, guild, config, channelId);
    });

    ctx.undo('rules.unpublish', async (entry, payload) => {
      const channelId = String(payload.channelId ?? '');
      const messageId = String(payload.messageId ?? '');
      if (!channelId || !messageId) return;
      await gate.unpublish(entry.guildId, channelId, messageId);
    });

    ctx.privacy(welcomePrivacy(store));
  },
});
