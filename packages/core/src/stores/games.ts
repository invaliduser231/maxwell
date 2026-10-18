import type { Sql } from '../db/sql.js';
import type { GameKey, TriviaQuestion } from '../modules/games.js';

export type Board = 'wins' | 'best' | 'net';

export interface ScoreRow {
  userId: string;
  wins: number;
  plays: number;
  best: number;
  net: number;
}

export interface OverallRow {
  userId: string;
  wins: number;
  plays: number;
  topGame: GameKey;
  topWins: number;
}

export interface ChannelState extends ChannelGame {
  channelId: string;
  game: GameKey;
}

export interface ChannelGame {
  current: number;
  lastWord: string | null;
  lastUser: string | null;
  highScore: number;
}

export type CountResult =
  | { ok: true; current: number; highScore: number; record: boolean }
  | {
      ok: false;
      reason: 'wrong' | 'twice';
      expected: number;
      reached: number;
      highScore: number;
      reset: boolean;
    };

export type WordResult =
  | { ok: true; length: number; highScore: number; record: boolean }
  | {
      ok: false;
      reason: 'letter' | 'repeat' | 'twice';
      letter: string | null;
      reached: number;
      highScore: number;
      reset: boolean;
    };

export interface HiloSession {
  guildId: string;
  userId: string;
  channelId: string;
  current: number;
  streak: number;
  stake: number;
  multiplier: number;
  expiresAt: Date;
}

export type DuelStatus = 'open' | 'done' | 'declined' | 'cancelled' | 'expired' | 'failed';

export interface Duel {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  challenger: string;
  opponent: string;
  stake: number;
  status: DuelStatus;
  winner: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface TriviaSession {
  id: string;
  guildId: string;
  channelId: string;
  question: TriviaQuestion;
  expiresAt: Date;
}

export type MemberData = {
  scores: {
    game: string;
    wins: number;
    plays: number;
    best: number;
    net: number;
    updatedAt: Date;
  }[];
  hilo: {
    current: number;
    streak: number;
    stake: number;
    multiplier: number;
    expiresAt: Date;
  } | null;
  duels: {
    challenged: boolean;
    otherId: string;
    stake: number;
    status: DuelStatus;
    won: boolean | null;
    createdAt: Date;
  }[];
};

const USED_LIMIT = 1_000;

export function lastLetter(word: string): string {
  const letters = [...word.toLowerCase()].filter((char) => /\p{L}/u.test(char));
  return letters.at(-1) ?? '';
}

export function firstLetter(word: string): string {
  return [...word.toLowerCase()].find((char) => /\p{L}/u.test(char)) ?? '';
}

const duelColumns = (sql: Sql) => sql`
  id::text as id, guild_id::text as "guildId", channel_id::text as "channelId",
  message_id::text as "messageId", challenger::text as challenger, opponent::text as opponent,
  stake::float8 as stake, status, winner::text as winner, created_at as "createdAt",
  expires_at as "expiresAt"
`;

const triviaColumns = (sql: Sql) => sql`
  session_id as id, guild_id::text as "guildId", channel_id::text as "channelId", question,
  expires_at as "expiresAt"
`;

const hiloColumns = (sql: Sql) => sql`
  guild_id::text as "guildId", user_id::text as "userId", channel_id::text as "channelId",
  current, streak, stake::float8 as stake, multiplier, expires_at as "expiresAt"
`;

export class GamesStore {
  constructor(private readonly sql: Sql) {}

  async score(
    guildId: string,
    game: GameKey,
    userId: string,
    result: { win?: boolean; best?: number; net?: number; play?: boolean },
  ): Promise<void> {
    const wins = result.win ? 1 : 0;
    const plays = result.play === false ? 0 : 1;
    await this.sql`
      insert into games_scores (guild_id, game, user_id, wins, plays, best, net)
      values (${guildId}, ${game}, ${userId}, ${wins}, ${plays}, ${result.best ?? 0}, ${result.net ?? 0}::bigint)
      on conflict (guild_id, game, user_id) do update set
        wins = games_scores.wins + excluded.wins,
        plays = games_scores.plays + excluded.plays,
        best = greatest(games_scores.best, excluded.best),
        net = games_scores.net + excluded.net,
        updated_at = now()
    `;
  }

  async leaderboard(
    guildId: string,
    game: GameKey,
    by: Board,
    limit = 10,
    offset = 0,
  ): Promise<ScoreRow[]> {
    const order = this.sql(by);
    return this.sql<ScoreRow[]>`
      select user_id::text as "userId", wins, plays, best, net::float8 as net
      from games_scores
      where guild_id = ${guildId} and game = ${game} and ${order} > 0
      order by ${order} desc, plays, user_id
      limit ${Math.min(Math.max(limit, 1), 200)} offset ${Math.max(offset, 0)}
    `;
  }

  async rank(
    guildId: string,
    game: GameKey,
    userId: string,
    by: Board,
  ): Promise<{ rank: number; row: ScoreRow } | null> {
    const order = this.sql(by);
    const [row] = await this.sql<(ScoreRow & { rank: number })[]>`
      select user_id::text as "userId", wins, plays, best, net::float8 as net,
        (select count(*)::int + 1 from games_scores o
          where o.guild_id = s.guild_id and o.game = s.game and o.${order} > s.${order}) as rank
      from games_scores s
      where s.guild_id = ${guildId} and s.game = ${game} and s.user_id = ${userId} and s.${order} > 0
    `;
    if (!row) return null;
    const { rank, ...rest } = row;
    return { rank, row: rest };
  }

  async overall(guildId: string, limit = 10): Promise<OverallRow[]> {
    return this.sql<OverallRow[]>`
      select user_id::text as "userId", sum(wins)::int as wins, sum(plays)::int as plays,
        (array_agg(game order by wins desc, game))[1] as "topGame",
        max(wins)::int as "topWins"
      from games_scores
      where guild_id = ${guildId}
      group by user_id
      having sum(wins) > 0
      order by sum(wins) desc, sum(plays), user_id
      limit ${Math.min(Math.max(limit, 1), 200)}
    `;
  }

  async channelStates(guildId: string): Promise<ChannelState[]> {
    return this.sql<ChannelState[]>`
      select channel_id::text as "channelId", game, current, last_word as "lastWord",
        last_user::text as "lastUser", high_score as "highScore"
      from games_channels where guild_id = ${guildId}
      order by updated_at desc
    `;
  }

  async channelGame(
    guildId: string,
    channelId: string,
    game: GameKey,
  ): Promise<ChannelGame | null> {
    const [row] = await this.sql<ChannelGame[]>`
      select current, last_word as "lastWord", last_user::text as "lastUser", high_score as "highScore"
      from games_channels where guild_id = ${guildId} and channel_id = ${channelId} and game = ${game}
    `;
    return row ?? null;
  }

  async resetChannel(
    guildId: string,
    channelId: string,
    game: GameKey,
  ): Promise<ChannelGame | null> {
    const before = await this.channelGame(guildId, channelId, game);
    await this.sql`
      update games_channels set current = 0, last_word = null, last_user = null, used = '{}', updated_at = now()
      where guild_id = ${guildId} and channel_id = ${channelId} and game = ${game}
    `;
    return before;
  }

  async restoreChannel(
    guildId: string,
    channelId: string,
    game: GameKey,
    state: ChannelGame,
  ): Promise<void> {
    await this.sql`
      insert into games_channels (guild_id, channel_id, game, current, last_word, last_user, high_score)
      values (${guildId}, ${channelId}, ${game}, ${state.current}, ${state.lastWord}, ${state.lastUser},
        ${state.highScore})
      on conflict (guild_id, channel_id, game) do update set current = excluded.current,
        last_word = excluded.last_word, last_user = excluded.last_user,
        high_score = greatest(games_channels.high_score, excluded.high_score), updated_at = now()
    `;
  }

  async count(
    guildId: string,
    channelId: string,
    userId: string,
    value: number,
    rules: { allowSameUser: boolean; resetOnMistake: boolean },
  ): Promise<CountResult> {
    return this.sql.begin(async (tx) => {
      await tx`
        insert into games_channels (guild_id, channel_id, game) values (${guildId}, ${channelId}, 'counting')
        on conflict (guild_id, channel_id, game) do nothing
      `;
      const [row] = await tx<{ current: number; lastUser: string | null; highScore: number }[]>`
        select current, last_user::text as "lastUser", high_score as "highScore" from games_channels
        where guild_id = ${guildId} and channel_id = ${channelId} and game = 'counting'
        for update
      `;
      const current = row?.current ?? 0;
      const high = row?.highScore ?? 0;
      const twice = !rules.allowSameUser && row?.lastUser === userId;
      if (value === current + 1 && !twice) {
        const highScore = Math.max(high, value);
        await tx`
          update games_channels set current = ${value}, last_user = ${userId}, high_score = ${highScore},
            updated_at = now()
          where guild_id = ${guildId} and channel_id = ${channelId} and game = 'counting'
        `;
        return { ok: true as const, current: value, highScore, record: value > high };
      }
      if (rules.resetOnMistake) {
        await tx`
          update games_channels set current = 0, last_user = null, updated_at = now()
          where guild_id = ${guildId} and channel_id = ${channelId} and game = 'counting'
        `;
      }
      return {
        ok: false as const,
        reason: twice ? ('twice' as const) : ('wrong' as const),
        expected: current + 1,
        reached: current,
        highScore: high,
        reset: rules.resetOnMistake,
      };
    });
  }

  async word(
    guildId: string,
    channelId: string,
    userId: string,
    word: string,
    rules: { allowSameUser: boolean; allowRepeat: boolean; resetOnMistake: boolean },
  ): Promise<WordResult> {
    const value = word.toLowerCase();
    return this.sql.begin(async (tx) => {
      await tx`
        insert into games_channels (guild_id, channel_id, game) values (${guildId}, ${channelId}, 'wordchain')
        on conflict (guild_id, channel_id, game) do nothing
      `;
      const [row] = await tx<
        {
          current: number;
          lastWord: string | null;
          lastUser: string | null;
          highScore: number;
          used: string[];
        }[]
      >`
        select current, last_word as "lastWord", last_user::text as "lastUser", high_score as "highScore", used
        from games_channels
        where guild_id = ${guildId} and channel_id = ${channelId} and game = 'wordchain'
        for update
      `;
      const current = row?.current ?? 0;
      const high = row?.highScore ?? 0;
      const letter = row?.lastWord ? lastLetter(row.lastWord) : null;
      const reason =
        !rules.allowSameUser && row?.lastUser === userId
          ? ('twice' as const)
          : letter && firstLetter(value) !== letter
            ? ('letter' as const)
            : !rules.allowRepeat && (row?.used ?? []).includes(value)
              ? ('repeat' as const)
              : null;
      if (!reason) {
        const length = current + 1;
        const highScore = Math.max(high, length);
        const used = [...(row?.used ?? []), value].slice(-USED_LIMIT);
        await tx`
          update games_channels set current = ${length}, last_word = ${value}, last_user = ${userId},
            high_score = ${highScore}, used = ${used}::text[], updated_at = now()
          where guild_id = ${guildId} and channel_id = ${channelId} and game = 'wordchain'
        `;
        return { ok: true as const, length, highScore, record: length > high };
      }
      if (rules.resetOnMistake) {
        await tx`
          update games_channels set current = 0, last_word = null, last_user = null, used = '{}',
            updated_at = now()
          where guild_id = ${guildId} and channel_id = ${channelId} and game = 'wordchain'
        `;
      }
      return {
        ok: false as const,
        reason,
        letter,
        reached: current,
        highScore: high,
        reset: rules.resetOnMistake,
      };
    });
  }

  async startHilo(session: HiloSession): Promise<boolean> {
    const rows = await this.sql`
      insert into games_hilo (guild_id, user_id, channel_id, current, streak, stake, multiplier, expires_at)
      values (${session.guildId}, ${session.userId}, ${session.channelId}, ${session.current},
        ${session.streak}, ${session.stake}::bigint, ${session.multiplier}, ${session.expiresAt})
      on conflict (guild_id, user_id) do nothing
      returning 1
    `;
    return rows.length > 0;
  }

  async hilo(guildId: string, userId: string): Promise<HiloSession | null> {
    const [row] = await this.sql<HiloSession[]>`
      select ${hiloColumns(this.sql)} from games_hilo where guild_id = ${guildId} and user_id = ${userId}
    `;
    return row ?? null;
  }

  async activeHilo(): Promise<HiloSession[]> {
    return this.sql<HiloSession[]>`select ${hiloColumns(this.sql)} from games_hilo`;
  }

  async advanceHilo(
    guildId: string,
    userId: string,
    from: number,
    next: { current: number; streak: number; multiplier: number; expiresAt: Date },
  ): Promise<boolean> {
    const rows = await this.sql`
      update games_hilo set current = ${next.current}, streak = ${next.streak},
        multiplier = ${next.multiplier}, expires_at = ${next.expiresAt}
      where guild_id = ${guildId} and user_id = ${userId} and streak = ${from}
      returning 1
    `;
    return rows.length > 0;
  }

  async endHilo(guildId: string, userId: string, onlyExpired = false): Promise<HiloSession | null> {
    const [row] = await this.sql<HiloSession[]>`
      delete from games_hilo
      where guild_id = ${guildId} and user_id = ${userId}
        ${onlyExpired ? this.sql`and expires_at <= now()` : this.sql``}
      returning ${hiloColumns(this.sql)}
    `;
    return row ?? null;
  }

  async createDuel(input: {
    guildId: string;
    channelId: string;
    challenger: string;
    opponent: string;
    stake: number;
    expiresAt: Date;
  }): Promise<Duel> {
    const [row] = await this.sql<Duel[]>`
      insert into games_duels (guild_id, channel_id, challenger, opponent, stake, expires_at)
      values (${input.guildId}, ${input.channelId}, ${input.challenger}, ${input.opponent},
        ${input.stake}::bigint, ${input.expiresAt})
      returning ${duelColumns(this.sql)}
    `;
    if (!row) throw new Error('duel insert returned nothing');
    return row;
  }

  async setDuelMessage(duelId: string, messageId: string): Promise<void> {
    await this.sql`update games_duels set message_id = ${messageId} where id = ${duelId}`;
  }

  async duel(duelId: string): Promise<Duel | null> {
    const [row] = await this.sql<
      Duel[]
    >`select ${duelColumns(this.sql)} from games_duels where id = ${duelId}`;
    return row ?? null;
  }

  async openDuels(): Promise<Duel[]> {
    return this.sql<Duel[]>`
      select ${duelColumns(this.sql)} from games_duels
      where status = 'open' and message_id is not null and expires_at > now()
    `;
  }

  async openDuelFor(guildId: string, userId: string): Promise<Duel | null> {
    const [row] = await this.sql<Duel[]>`
      select ${duelColumns(this.sql)} from games_duels
      where guild_id = ${guildId} and status = 'open' and expires_at > now()
        and (challenger = ${userId} or opponent = ${userId})
      limit 1
    `;
    return row ?? null;
  }

  async closeDuel(
    duelId: string,
    status: Exclude<DuelStatus, 'open'>,
    winner: string | null = null,
  ): Promise<Duel | null> {
    const [row] = await this.sql<Duel[]>`
      update games_duels set status = ${status}, winner = ${winner}
      where id = ${duelId} and status = 'open'
      returning ${duelColumns(this.sql)}
    `;
    return row ?? null;
  }

  async markDuel(
    duelId: string,
    status: Exclude<DuelStatus, 'open'>,
    winner: string | null = null,
  ): Promise<void> {
    await this
      .sql`update games_duels set status = ${status}, winner = ${winner} where id = ${duelId}`;
  }

  async startTrivia(session: TriviaSession): Promise<boolean> {
    const rows = await this.sql`
      insert into games_trivia as t (channel_id, guild_id, session_id, question, expires_at)
      values (${session.channelId}, ${session.guildId}, ${session.id},
        ${this.sql.json(session.question as never)}, ${session.expiresAt})
      on conflict (channel_id) do update set guild_id = excluded.guild_id,
        session_id = excluded.session_id, question = excluded.question,
        expires_at = excluded.expires_at, created_at = now()
        where t.expires_at <= now()
      returning 1
    `;
    return rows.length > 0;
  }

  async trivia(channelId: string): Promise<TriviaSession | null> {
    const [row] = await this.sql<TriviaSession[]>`
      select ${triviaColumns(this.sql)} from games_trivia where channel_id = ${channelId}
    `;
    return row ?? null;
  }

  async openTrivia(): Promise<TriviaSession[]> {
    return this.sql<TriviaSession[]>`select ${triviaColumns(this.sql)} from games_trivia`;
  }

  async endTrivia(
    channelId: string,
    sessionId: string,
    onlyOpen = false,
  ): Promise<TriviaSession | null> {
    const [row] = await this.sql<TriviaSession[]>`
      delete from games_trivia
      where channel_id = ${channelId} and session_id = ${sessionId}
        ${onlyOpen ? this.sql`and expires_at > now()` : this.sql``}
      returning ${triviaColumns(this.sql)}
    `;
    return row ?? null;
  }

  async memberData(guildId: string, userId: string): Promise<MemberData | null> {
    const scores = await this.sql<MemberData['scores']>`
      select game, wins, plays, best, net::float8 as net, updated_at as "updatedAt"
      from games_scores where guild_id = ${guildId} and user_id = ${userId}
      order by game
    `;
    const [hilo] = await this.sql<NonNullable<MemberData['hilo']>[]>`
      select current, streak, stake::float8 as stake, multiplier, expires_at as "expiresAt"
      from games_hilo where guild_id = ${guildId} and user_id = ${userId}
    `;
    const duels = await this.sql<MemberData['duels']>`
      select challenger = ${userId} as challenged,
        (case when challenger = ${userId} then opponent else challenger end)::text as "otherId",
        stake::float8 as stake, status,
        case when winner is null then null else winner = ${userId} end as won,
        created_at as "createdAt"
      from games_duels
      where guild_id = ${guildId} and (challenger = ${userId} or opponent = ${userId})
      order by id
    `;
    if (scores.length === 0 && !hilo && duels.length === 0) return null;
    return { scores: [...scores], hilo: hilo ?? null, duels: [...duels] };
  }

  async forget(guildId: string, userId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`delete from games_scores where guild_id = ${guildId} and user_id = ${userId}`;
      await tx`delete from games_hilo where guild_id = ${guildId} and user_id = ${userId}`;
      await tx`
        delete from games_duels
        where guild_id = ${guildId} and (challenger = ${userId} or opponent = ${userId})
      `;
      await tx`
        update games_channels set last_user = null
        where guild_id = ${guildId} and last_user = ${userId}
      `;
    });
  }
}
