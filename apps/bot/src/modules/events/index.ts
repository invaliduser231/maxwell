import definition from '@maxwell/core/modules/events';
import { defineBotModule } from '../../runtime/module.js';
import { eventCommands } from './commands.js';
import { EventService } from './events.js';
import { PollService } from './polls.js';
import { ReactionRouter } from './reactions.js';
import { TargetCache } from './targets.js';

export default defineBotModule({
  definition,
  setup(ctx) {
    const targets = new TargetCache();
    const events = new EventService(ctx, targets);
    const polls = new PollService(ctx, targets);
    const router = new ReactionRouter(ctx, targets, events, polls);

    ctx.on('reaction', (reaction) => router.handle(reaction, true));
    ctx.on('reactionRemove', (reaction) => router.handle(reaction, false));
    ctx.on('messageRemove', (removal) => router.removed(removal));
    ctx.on(
      'ready',
      async () => {
        await events.preload();
        await polls.preload();
        await events.queueSyncs();
        await polls.queueSyncs();
      },
      { always: true },
    );

    ctx.privacy({
      async export(guildId, userId) {
        const [ownEvents, ownPolls] = await Promise.all([
          events.exportMember(guildId, userId),
          polls.exportMember(guildId, userId),
        ]);
        if (!ownEvents && !ownPolls) return null;
        return { ...ownEvents, ...ownPolls };
      },
      async forget(guildId, userId) {
        await events.forgetMember(guildId, userId);
        await polls.forgetMember(guildId, userId);
      },
    });

    ctx.job('publish', async (job) => {
      const eventId = String(job.payload.eventId ?? '');
      if (job.guildId && /^\d+$/.test(eventId)) await events.publish(job.guildId, eventId);
    });
    ctx.job('delete', (job) => events.remove(job));
    ctx.job('reminder', (job) => events.remind(job));
    ctx.job('start', (job) => events.start(job));
    ctx.job('end', (job) => events.end(job));
    ctx.job('rsvp.refresh', (job) => events.refresh(job));
    ctx.job('rsvp.sync', (job) => events.syncJob(job));
    ctx.job('poll.sync', (job) => polls.syncJob(job));
    ctx.job('poll.publish', (job) => polls.publishJob(job));
    ctx.job('poll.close', (job) => polls.closeJob(job));
    ctx.job('poll.cancel', async (job) => {
      if (job.guildId) await polls.cancelPoll(job.guildId, String(job.payload.pollId ?? ''));
    });
    ctx.job('poll.refresh', (job) => polls.refresh(job));

    ctx.undo('event.cancel', async (entry, payload) => {
      await events.cancel(entry.guildId, String(payload.eventId ?? ''), null);
    });
    ctx.undo('event.restore', async (entry, payload) => {
      await events.restore(entry.guildId, String(payload.eventId ?? ''));
    });
    ctx.undo('poll.cancel', async (entry, payload) => {
      await polls.cancelPoll(entry.guildId, String(payload.pollId ?? ''));
    });

    return eventCommands(events, polls);
  },
});
