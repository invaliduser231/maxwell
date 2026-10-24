import { economyConfig } from '@maxwell/core/modules/economy';
import { type GameKey, games, gamesConfig } from '@maxwell/core/modules/games';
import { EconomyStore, type KindTotal } from '@maxwell/core/stores/economy';
import { GamesStore } from '@maxwell/core/stores/games';
import type { Metadata } from 'next';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { loadModule } from '@/lib/module';
import { people, personOf } from '@/lib/people';
import { type BoardRow, GamesForm } from './games-form';

export const metadata: Metadata = { title: 'Games' };

const boards: Record<GameKey, 'wins' | 'best'> = {
  trivia: 'wins',
  counting: 'wins',
  wordchain: 'wins',
  higherlower: 'best',
  coinflip: 'wins',
};

function total(rows: KindTotal[], kind: string, side: 'credited' | 'debited'): number {
  return rows.find((row) => row.kind === kind)?.[side] ?? 0;
}

export default async function GamesPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const loaded = await loadModule(guild, 'games', gamesConfig);
  const store = new GamesStore(db().sql);
  const wallet = new EconomyStore(db().sql);
  const [overall, perGame, channels, economy, economyOn, prefix, all, hilo, flips] =
    await Promise.all([
      store.overall(guild, 8),
      Promise.all(games.map((game) => store.leaderboard(guild, game, boards[game], 8))),
      store.channelStates(guild),
      db().modules.get(guild, 'economy', economyConfig),
      db().modules.isEnabled(guild, 'economy'),
      db().guilds.prefix(guild),
      wallet.kindTotals(guild, 30),
      wallet.kindTotals(guild, 30, 'higherlower'),
      wallet.kindTotals(guild, 30, 'coinflip'),
    ]);
  const names = await people([
    ...overall.map((row) => row.userId),
    ...perGame.flat().map((row) => row.userId),
  ]);
  const person = (userId: string) => {
    const found = personOf(names, userId);
    return { name: found.name, avatar: found.avatar };
  };

  const board: Record<string, BoardRow[]> = {
    all: overall.map((row) => ({
      userId: row.userId,
      ...person(row.userId),
      game: row.topGame,
      wins: row.wins,
      plays: row.plays,
      best: row.topWins,
    })),
  };
  games.forEach((game, i) => {
    board[game] = (perGame[i] ?? []).map((row) => ({
      userId: row.userId,
      ...person(row.userId),
      game,
      wins: row.wins,
      plays: row.plays,
      best: row.best,
    }));
  });

  const staked = total(all, 'stake', 'debited');
  const gamePaid = total(all, 'game', 'credited');
  const stakePaid = total(hilo, 'game', 'credited') + total(flips, 'game', 'credited');
  const refunded = total(hilo, 'refund', 'credited');

  return (
    <ModuleShell {...loaded.shell}>
      <GamesForm
        prefix={prefix}
        board={board}
        channels={channels.map((state) => ({
          channelId: state.channelId,
          game: state.game,
          current: state.current,
          highScore: state.highScore,
          lastWord: state.lastWord,
        }))}
        economy={{
          on: economyOn,
          symbol: economy.currency.symbol,
          name: economy.currency.name,
          perWin: economy.rewards.gameWin,
        }}
        money={{
          rewards: Math.max(gamePaid - stakePaid, 0),
          staked,
          house: Math.max(staked - stakePaid - refunded, 0),
        }}
      />
    </ModuleShell>
  );
}
