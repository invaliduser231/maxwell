import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/games';
import { GamesStore } from '@maxwell/core/stores/games';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('GamesStore', () => {
  let sql: Sql;
  let store: GamesStore;
  const guild = String(930_000_000_000_000n + BigInt(Math.floor(Math.random() * 1_000_000_000)));
  const a = '600000000000000001';
  const b = '600000000000000002';
  const channel = '610000000000000001';
  const rules = { allowSameUser: false, resetOnMistake: true };

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'games', migrations: definition.migrations },
    ]);
    store = new GamesStore(sql);
  });

  afterAll(async () => {
    for (const table of [
      'games_scores',
      'games_channels',
      'games_hilo',
      'games_duels',
      'games_trivia',
    ]) {
      await sql`delete from ${sql(table)} where guild_id = ${guild}`;
    }
    await sql.end();
  });

  it('counts in turns and resets on a mistake', async () => {
    expect(await store.count(guild, channel, a, 1, rules)).toMatchObject({ ok: true, current: 1 });
    expect(await store.count(guild, channel, a, 2, rules)).toMatchObject({
      ok: false,
      reason: 'twice',
    });
    expect(await store.count(guild, channel, b, 1, rules)).toMatchObject({ ok: true, current: 1 });
    expect(await store.count(guild, channel, a, 2, rules)).toMatchObject({
      ok: true,
      record: true,
    });
    const wrong = await store.count(guild, channel, b, 5, rules);
    expect(wrong).toMatchObject({
      ok: false,
      reason: 'wrong',
      expected: 3,
      reached: 2,
      highScore: 2,
    });
    expect((await store.channelGame(guild, channel, 'counting'))?.current).toBe(0);
  });

  it('chains words by their last letter', async () => {
    const wordRules = { allowSameUser: false, allowRepeat: false, resetOnMistake: true };
    expect(await store.word(guild, channel, a, 'Apple', wordRules)).toMatchObject({
      ok: true,
      length: 1,
    });
    expect(await store.word(guild, channel, b, 'egg', wordRules)).toMatchObject({
      ok: true,
      length: 2,
    });
    expect(await store.word(guild, channel, a, 'apple', wordRules)).toMatchObject({
      ok: false,
      reason: 'letter',
      letter: 'g',
    });
    expect(await store.word(guild, channel, a, 'apple', wordRules)).toMatchObject({
      ok: true,
      length: 1,
    });
    expect(await store.word(guild, channel, b, 'egg', wordRules)).toMatchObject({ ok: true });
    expect(await store.word(guild, channel, a, 'giraffe', wordRules)).toMatchObject({ ok: true });
    expect(await store.word(guild, channel, b, 'egg', wordRules)).toMatchObject({
      ok: false,
      reason: 'repeat',
    });
  });

  it('keeps scores and ranks', async () => {
    await store.score(guild, 'trivia', a, { win: true });
    await store.score(guild, 'trivia', a, { win: true });
    await store.score(guild, 'trivia', b, { win: true });
    const board = await store.leaderboard(guild, 'trivia', 'wins');
    expect(board.map((row) => row.userId)).toEqual([a, b]);
    expect((await store.rank(guild, 'trivia', b, 'wins'))?.rank).toBe(2);
    await store.score(guild, 'higherlower', b, { best: 4 });
    await store.score(guild, 'higherlower', b, { best: 2 });
    expect((await store.leaderboard(guild, 'higherlower', 'best'))[0]?.best).toBe(4);
  });

  it('ends a higher or lower session once', async () => {
    const session = {
      guildId: guild,
      userId: a,
      channelId: channel,
      current: 50,
      streak: 0,
      stake: 100,
      multiplier: 1,
      expiresAt: new Date(Date.now() + 60_000),
    };
    expect(await store.startHilo(session)).toBe(true);
    expect(await store.startHilo(session)).toBe(false);
    expect(
      await store.advanceHilo(guild, a, 0, {
        current: 70,
        streak: 1,
        multiplier: 1.9,
        expiresAt: session.expiresAt,
      }),
    ).toBe(true);
    expect(
      await store.advanceHilo(guild, a, 0, {
        current: 70,
        streak: 1,
        multiplier: 1.9,
        expiresAt: session.expiresAt,
      }),
    ).toBe(false);
    expect(await store.endHilo(guild, a, true)).toBeNull();
    const ended = await Promise.all([store.endHilo(guild, a), store.endHilo(guild, a)]);
    expect(ended.filter(Boolean)).toHaveLength(1);
    expect(ended.find(Boolean)?.multiplier).toBeCloseTo(1.9);
  });

  it('closes a duel only once', async () => {
    const duel = await store.createDuel({
      guildId: guild,
      channelId: channel,
      challenger: a,
      opponent: b,
      stake: 50,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await store.openDuelFor(guild, b))?.id).toBe(duel.id);
    const results = await Promise.all([
      store.closeDuel(duel.id, 'done', a),
      store.closeDuel(duel.id, 'expired'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('keeps one open trivia question per channel and ends it once', async () => {
    const room = String(620_000_000_000_000_000n + BigInt(Math.floor(Math.random() * 1e9)));
    const question = { question: 'Two plus two?', answers: ['4'], choices: [] };
    const session = {
      id: 's1',
      guildId: guild,
      channelId: room,
      question,
      expiresAt: new Date(Date.now() + 60_000),
    };
    expect(await store.startTrivia(session)).toBe(true);
    expect(await store.startTrivia({ ...session, id: 's2' })).toBe(false);
    expect((await store.trivia(room))?.question).toEqual(question);
    expect((await store.openTrivia()).some((open) => open.id === 's1')).toBe(true);
    const ended = await Promise.all([
      store.endTrivia(room, 's1', true),
      store.endTrivia(room, 's1'),
    ]);
    expect(ended.filter(Boolean)).toHaveLength(1);
    expect(await store.trivia(room)).toBeNull();
  });

  it('replaces a stale trivia question and refuses a late answer', async () => {
    const room = String(630_000_000_000_000_000n + BigInt(Math.floor(Math.random() * 1e9)));
    const question = { question: 'Capital of France?', answers: ['Paris'], choices: [] };
    const stale = {
      id: 'old',
      guildId: guild,
      channelId: room,
      question,
      expiresAt: new Date(Date.now() - 1_000),
    };
    expect(await store.startTrivia(stale)).toBe(true);
    expect(await store.endTrivia(room, 'old', true)).toBeNull();
    expect(
      await store.startTrivia({ ...stale, id: 'new', expiresAt: new Date(Date.now() + 60_000) }),
    ).toBe(true);
    expect(await store.endTrivia(room, 'old')).toBeNull();
    expect((await store.trivia(room))?.id).toBe('new');
  });

  it('exports and forgets a member', async () => {
    const data = await store.memberData(guild, a);
    expect(data?.scores.map((row) => row.game)).toContain('trivia');
    expect(data?.duels[0]).toMatchObject({ challenged: true, otherId: b });
    await store.count(guild, channel, a, 1, rules);
    expect((await store.channelGame(guild, channel, 'counting'))?.lastUser).toBe(a);
    await store.forget(guild, a);
    expect(await store.memberData(guild, a)).toBeNull();
    expect((await store.memberData(guild, b))?.duels).toEqual([]);
    expect((await store.channelGame(guild, channel, 'counting'))?.lastUser).toBeNull();
    expect(await store.memberData(guild, '600000000000000099')).toBeNull();
  });

  it('ranks players across games and lists channel states', async () => {
    await store.score(guild, 'trivia', b, { win: true });
    await store.score(guild, 'trivia', b, { win: true });
    await store.score(guild, 'coinflip', b, { win: true });
    const rows = await store.overall(guild, 5);
    expect(rows[0]).toMatchObject({ userId: b, topGame: 'trivia' });
    expect(rows[0]?.topWins).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.wins).toBeGreaterThanOrEqual(3);
    const states = await store.channelStates(guild);
    expect(states.some((state) => state.channelId === channel && state.game === 'counting')).toBe(
      true,
    );
  });
});
