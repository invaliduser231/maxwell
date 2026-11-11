import definition from '@maxwell/core/modules/games';
import { defineBotModule } from '../../runtime/module.js';
import { Wallets } from '../economy/wallets.js';
import { ChannelGames } from './channels.js';
import { Coinflip } from './coinflip.js';
import { gamesCommands } from './commands.js';
import { HigherLower } from './hilo.js';
import { registerGamesJobs } from './jobs.js';
import { Games } from './service.js';
import { Trivia } from './trivia.js';

export default defineBotModule({
  definition,
  setup(ctx) {
    const schedule = ctx.schedule.bind(ctx);
    const games = new Games(ctx.services, new Wallets(ctx.services));
    const trivia = new Trivia(games, schedule);
    const channels = new ChannelGames(games);
    const hilo = new HigherLower(games, schedule);
    const coinflip = new Coinflip(games, schedule);

    ctx.on('message', (message) => trivia.onMessage(message));
    ctx.on('message', (message) => channels.onMessage(message));
    ctx.on('message', (message) => hilo.onMessage(message));
    ctx.on('reaction', (reaction) => coinflip.onReaction(reaction));
    ctx.on('reaction', (reaction) => hilo.onReaction(reaction, true));
    ctx.on('reactionRemove', (reaction) => hilo.onReaction(reaction, false));
    ctx.on(
      'ready',
      async () => {
        await hilo.load();
        await coinflip.load();
        await trivia.load();
      },
      { always: true },
    );

    registerGamesJobs(ctx, games, trivia, hilo, coinflip);
    ctx.privacy({
      export: (guildId, userId) => games.store.memberData(guildId, userId),
      forget: (guildId, userId) => games.store.forget(guildId, userId),
    });

    return gamesCommands(games, trivia, hilo, coinflip);
  },
});
