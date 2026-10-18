import definition from '@maxwell/core/modules/forms';
import { FormStore } from '@maxwell/core/stores/forms';
import { defineBotModule } from '../../runtime/module.js';
import { formCommands } from './commands.js';
import { formInboxFor } from './inbox.js';
import { formPrivacy } from './privacy.js';
import { isDecision, Reviews } from './review.js';
import { FormRunner } from './sessions.js';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export default defineBotModule({
  definition,
  setup(ctx) {
    const { services } = ctx;
    const { platform, log } = services;
    const store = new FormStore(services.sql);
    const inbox = formInboxFor(services);
    const reviews = new Reviews(ctx, store);
    const runner = new FormRunner(ctx, store, inbox, reviews);
    ctx.privacy(formPrivacy(store, runner, platform));

    ctx.on(
      'ready',
      async () => {
        inbox.load(await store.activeSessions());
      },
      { always: true },
    );
    ctx.on('message', (message) => runner.onMessage(message), { always: true });
    ctx.on('reaction', (reaction) => reviews.onReaction(reaction, true));
    ctx.on('reactionRemove', (reaction) => reviews.onReaction(reaction, false));
    ctx.on('channelDelete', ({ channel }) => runner.onChannelGone(channel.id), { always: true });

    ctx.job('review', async (job) => {
      const submissionId = text(job.payload.submissionId);
      const decision = job.payload.decision;
      if (!job.guildId || !submissionId || !isDecision(decision)) return;
      const outcome = await reviews.decide(
        job.guildId,
        submissionId,
        decision,
        { id: text(job.payload.by) ?? text(job.payload.actorId) },
        text(job.payload.note),
      );
      if (outcome !== 'done') {
        log.info({ guild: job.guildId, submission: submissionId, outcome }, 'form review skipped');
      }
    });

    ctx.job('session.expire', async (job) => {
      const sessionId = text(job.payload.sessionId);
      if (sessionId) await runner.expire(sessionId);
    });

    ctx.job('cleanup', async (job) => {
      const channelId = text(job.payload.channelId);
      if (!channelId) return;
      await platform
        .deleteChannel(channelId, 'Maxwell forms')
        .catch((error) =>
          log.info({ err: error, channel: channelId }, 'form channel cleanup failed'),
        );
    });

    ctx.undo('decision', async (entry, payload) => {
      const submissionId = text(payload.submissionId);
      if (submissionId) await reviews.revert(entry.guildId, submissionId);
    });

    return [formCommands(ctx, runner)];
  },
});
