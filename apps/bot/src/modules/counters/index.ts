import definition from '@maxwell/core/modules/counters';
import { defineBotModule } from '../../runtime/module.js';
import { nextSlot } from '../insights/recurring.js';
import { CounterBoard } from './board.js';
import { counterCommand } from './commands.js';

const TICK = 10 * 60_000;
const CHANGE_DELAY = 5_000;

export function changedGuild(payload: string): string | null {
  const [guildId, key, ...rest] = payload.split(':');
  if (rest.length > 0 || key !== definition.key || !guildId || !/^\d{1,21}$/.test(guildId)) {
    return null;
  }
  return guildId;
}

export default defineBotModule({
  definition,
  setup(ctx) {
    const { services } = ctx;
    const { platform, log } = services;
    const board = new CounterBoard(ctx);
    const scheduleTick = () => ctx.schedule('tick', nextSlot('counters.tick', TICK));

    ctx.job('tick', async () => {
      try {
        const renamed = await board.tick(platform.guildIds());
        if (renamed > 0) log.debug({ renamed }, 'counters renamed');
      } finally {
        await scheduleTick();
      }
    });

    ctx.job('refresh', async (job) => {
      if (!job.guildId) return;
      await board.refresh(job.guildId);
    });

    services.settings.onInvalidate((payload) => {
      const guildId = changedGuild(payload);
      if (!guildId) return;
      ctx
        .schedule('refresh', {
          guildId,
          runAt: new Date(Date.now() + CHANGE_DELAY),
          dedupeKey: `counters.refresh:${guildId}:${Math.floor(Date.now() / CHANGE_DELAY)}`,
        })
        .catch((error) => log.warn({ err: error, guild: guildId }, 'counter refresh not queued'));
    });

    ctx.on('channelDelete', ({ guildId, channel }) => board.forgetChannel(guildId, channel.id), {
      always: true,
    });
    ctx.on(
      'ready',
      async () => {
        await scheduleTick();
      },
      { always: true },
    );

    return [counterCommand(ctx, board)];
  },
});
