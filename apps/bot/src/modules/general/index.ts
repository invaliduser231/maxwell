import { RetentionStore } from '@maxwell/core';
import general from '@maxwell/core/modules/general';
import { AfkStore } from '@maxwell/core/stores/afk';
import { defineBotModule } from '../../runtime/module.js';
import { AfkTracker, afkCommand } from './afk.js';
import { generalCommands } from './commands.js';
import { greet } from './onboarding.js';
import { privacyCommands } from './privacy.js';

const VOTE_SYNC_MS = 60 * 60_000;
const DAY = 86_400_000;

function retentionAt(at: number): { runAt: Date; dedupeKey: string } {
  return { runAt: new Date(at), dedupeKey: `general.retention:${Math.floor(at / DAY)}` };
}

export default defineBotModule({
  definition: general,
  commands: [...generalCommands, ...privacyCommands],
  setup(ctx) {
    const { services } = ctx;
    const { platform, guilds, log, votes } = services;

    const afk = new AfkTracker(services, new AfkStore(services.sql));
    ctx.on('message', (message) => afk.onMessage(message), { always: true });
    ctx.privacy({
      export: async (guildId, userId) => {
        const [entry] = await new AfkStore(services.sql).get(guildId, [userId]);
        return entry ? { afk: { reason: entry.reason, since: entry.since.toISOString() } } : null;
      },
      forget: (guildId, userId) => afk.forget(guildId, userId),
    });

    ctx.on('ready', () => platform.setStatus('Mention me for help'), { always: true });
    ctx.on('guildAvailable', (guild) => guilds.joined(guild.id).then(() => undefined), {
      always: true,
    });
    ctx.on(
      'guildJoin',
      async (guild) => {
        log.info({ guild: guild.id, name: guild.name }, 'joined guild');
        if (await guilds.joined(guild.id)) await greet(services, guild);
      },
      { always: true },
    );
    ctx.on(
      'guildLeave',
      async (guildId) => {
        log.info({ guild: guildId }, 'left guild');
        await guilds.left(guildId);
      },
      { always: true },
    );

    ctx.job('votes.sync', async () => {
      const added = await votes.sync();
      if (added) log.info({ added }, 'new voters');
      await ctx.schedule('votes.sync', {
        runAt: new Date(Date.now() + VOTE_SYNC_MS),
        dedupeKey: 'general.votes.sync',
      });
    });
    const retention = new RetentionStore(services.sql);
    ctx.job('retention', async () => {
      const now = Date.now();
      try {
        const removed = await retention.run(now);
        if (Object.values(removed).some((count) => count > 0))
          log.info(removed, 'old data removed');
      } finally {
        await ctx.schedule('retention', retentionAt(now + DAY));
      }
    });

    ctx.on(
      'ready',
      async () => {
        await ctx.schedule('votes.sync', { dedupeKey: 'general.votes.sync' });
        await ctx.schedule('retention', retentionAt(Date.now() + 60_000));
      },
      { always: true },
    );

    return [afkCommand(afk)];
  },
});
