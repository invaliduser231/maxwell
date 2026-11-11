import type { GameKey } from '@maxwell/core/modules/games';
import type { Board, ScoreRow } from '@maxwell/core/stores/games';
import { mention } from '../../commands/mentions.js';
import type { Command } from '../../commands/types.js';
import type { Embed } from '../../platform/types.js';
import { code, lines, subtext } from '../../ui/format.js';
import { chunk } from '../../ui/paginator.js';
import { palette } from '../../ui/palette.js';
import type { Blackjack } from './blackjack.js';
import type { Coinflip } from './coinflip.js';
import { copy } from './copy.js';
import type { HigherLower } from './hilo.js';
import type { Games } from './service.js';
import type { Trivia } from './trivia.js';

const PAGE_SIZE = 10;

function describe(row: ScoreRow, by: Board): string {
  return by === 'best' ? copy.board.best(row.best) : copy.board.wins(row.wins);
}

export function boardCommand(games: Games, game: GameKey, by: Board): Command {
  return {
    name: 'top',
    description: copy.commands.top[game],
    guildOnly: true,
    cooldown: 5_000,
    args: [{ name: 'page', type: 'integer', min: 1, max: 10, optional: true }],
    async run(ctx) {
      const name = copy.names[game];
      const rows = await games.store.leaderboard(ctx.guildId, game, by, PAGE_SIZE * 10);
      if (rows.length === 0) {
        await ctx.reply(ctx.services.voice.empty(`games.${game}`, copy.board.empty, ctx.seed));
        return;
      }
      const own = await games.store.rank(ctx.guildId, game, ctx.message.author.id, by);
      const width = String(rows.length).length + 1;
      const you = own
        ? subtext(copy.board.you(own.rank, describe(own.row, by)))
        : subtext(copy.board.notYou);
      const pages: Embed[] = chunk(rows, PAGE_SIZE).map((group, page) => ({
        color: palette.north,
        title: copy.board.title(name),
        description: lines(
          ...group.map((row, i) => {
            const place = code(`#${page * PAGE_SIZE + i + 1}`.padEnd(width));
            return `${place}  ${mention.user(row.userId)}  **${describe(row, by)}**`;
          }),
          '',
          you,
        ),
      }));
      await ctx.services.pages.send(ctx, pages, (ctx.args.number('page') ?? 1) - 1);
    },
  };
}

export function gamesCommands(
  games: Games,
  trivia: Trivia,
  hilo: HigherLower,
  coinflip: Coinflip,
  blackjack: Blackjack,
): Command[] {
  const triviaCommand: Command = {
    name: 'trivia',
    aliases: ['quiz'],
    description: copy.commands.trivia,
    guildOnly: true,
    cooldown: 10_000,
    botPermissions: ['EmbedLinks'],
    subcommands: [boardCommand(games, 'trivia', 'wins')],
    examples: ['trivia', 'trivia top'],
    run: (ctx) => trivia.start(ctx),
  };

  const coinflipCommand: Command = {
    name: 'coinflip',
    aliases: ['cf', 'flip'],
    description: copy.commands.coinflip,
    guildOnly: true,
    cooldown: 3_000,
    args: [
      { name: 'member', type: 'user', optional: true },
      { name: 'stake', type: 'text', optional: true },
    ],
    subcommands: [boardCommand(games, 'coinflip', 'wins')],
    examples: ['coinflip', 'coinflip @Lena 100', 'coinflip top'],
    async run(ctx) {
      const stake = await games.stake(ctx, ctx.args.string('stake'));
      if (stake !== null) await coinflip.run(ctx, ctx.args.string('member'), stake);
    },
  };

  const higherlower: Command = {
    name: 'higherlower',
    aliases: ['hl', 'hilo'],
    description: copy.commands.higherlower,
    guildOnly: true,
    cooldown: 3_000,
    args: [{ name: 'stake', type: 'text', optional: true }],
    subcommands: [boardCommand(games, 'higherlower', 'best')],
    examples: ['higherlower', 'higherlower 50', 'higherlower top'],
    async run(ctx) {
      const stake = await games.stake(ctx, ctx.args.string('stake'));
      if (stake !== null) await hilo.start(ctx, stake);
    },
  };

  const blackjackCommand: Command = {
    name: 'blackjack',
    aliases: ['bj', '21'],
    description: copy.commands.blackjack,
    guildOnly: true,
    cooldown: 3_000,
    botPermissions: ['EmbedLinks'],
    args: [{ name: 'stake', type: 'text', optional: true }],
    subcommands: [boardCommand(games, 'blackjack', 'wins')],
    examples: ['blackjack', 'blackjack 100', 'blackjack all', 'blackjack top'],
    async run(ctx) {
      const stake = await games.stake(ctx, ctx.args.string('stake'));
      if (stake !== null) await blackjack.start(ctx, stake);
    },
  };

  return [triviaCommand, coinflipCommand, higherlower, blackjackCommand];
}
