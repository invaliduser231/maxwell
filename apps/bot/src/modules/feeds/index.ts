import definition from '@maxwell/core/modules/feeds';
import { FeedStore } from '@maxwell/core/stores/feeds';
import { defineBotModule } from '../../runtime/module.js';
import { FeedPoller } from './poller.js';
import { nextSlot } from './recurring.js';
import { TwitchClient, twitchCredentials } from './sources.js';

const TICK = 60_000;

function feedIdOf(payload: Record<string, unknown>): string | null {
  return typeof payload.feedId === 'string' && payload.feedId ? payload.feedId : null;
}

function actorOf(payload: Record<string, unknown>): { id: string | null } {
  return { id: typeof payload.by === 'string' && /^\d+$/.test(payload.by) ? payload.by : null };
}

export default defineBotModule({
  definition,
  setup(ctx) {
    const { sql, log, config } = ctx.services;
    const store = new FeedStore(sql);
    const credentials = twitchCredentials(config);
    if (!credentials) {
      log.info('twitch feeds need TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET, keeping them off');
    }
    const poller = new FeedPoller(ctx, store, {
      twitch: credentials ? new TwitchClient(credentials) : null,
    });

    const scheduleTick = () => ctx.schedule('tick', nextSlot('feeds.tick', TICK));

    ctx.job('tick', async () => {
      await scheduleTick();
      const queued = await poller.tick();
      if (queued) log.debug({ queued }, 'feed polls queued');
    });

    ctx.job('poll', async (job) => {
      const feedId = feedIdOf(job.payload);
      if (!job.guildId || !feedId) return;
      await poller.poll(job.guildId, feedId, job.payload.force === true);
    });

    ctx.job('test', async (job) => {
      const feedId = feedIdOf(job.payload);
      if (!job.guildId || !feedId) return;
      const outcome = await poller.test(job.guildId, feedId);
      log.info({ guild: job.guildId, feed: feedId, outcome }, 'feed test');
    });

    ctx.job('resume', async (job) => {
      const feedId = feedIdOf(job.payload);
      if (!job.guildId || !feedId) return;
      await poller.resume(job.guildId, feedId, actorOf(job.payload));
    });

    ctx.undo('resume', async (entry, payload) => {
      const feedId = feedIdOf(payload);
      if (feedId) await poller.resume(entry.guildId, feedId, null);
    });

    ctx.on('ready', () => scheduleTick().then(() => undefined), { always: true });
  },
});
