import general from '@maxwell/core/modules/general';
import { defineBotModule } from '../../runtime/module.js';
import { generalCommands } from './commands.js';
import { greet } from './onboarding.js';
import { privacyCommands } from './privacy.js';

const VOTE_SYNC_MS = 60 * 60_000;

export default defineBotModule({
  definition: general,
  commands: [...generalCommands, ...privacyCommands],
  setup(ctx) {
    const { services } = ctx;
    const { platform, guilds, log, config, votes } = services;

    ctx.on('ready', () => platform.setStatus(`${config.DEFAULT_PREFIX}help`), { always: true });
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
    ctx.on(
      'ready',
      async () => {
        await ctx.schedule('votes.sync', { dedupeKey: 'general.votes.sync' });
      },
      { always: true },
    );
  },
});
