import { connect, migrate, type Sql } from '@maxwell/core';
import definition, { gamesConfig } from '@maxwell/core/modules/games';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import type { GuildContext } from '../../src/commands/types.js';
import { createLogger } from '../../src/log.js';
import { Wallets } from '../../src/modules/economy/wallets.js';
import { Blackjack } from '../../src/modules/games/blackjack.js';
import { Coinflip } from '../../src/modules/games/coinflip.js';
import { HigherLower } from '../../src/modules/games/hilo.js';
import games from '../../src/modules/games/index.js';
import { Games } from '../../src/modules/games/service.js';
import { Trivia } from '../../src/modules/games/trivia.js';
import type { IncomingMessage, Outgoing, ReactionEvent } from '../../src/platform/types.js';
import { createContext } from '../../src/runtime/module.js';
import { PrivacyRegistry } from '../../src/runtime/privacy.js';
import type { JobHandler } from '../../src/runtime/scheduler.js';
import type { Services } from '../../src/services.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('games module', () => {
  let sql: Sql;
  let services: Services;
  let service: Games;
  const guild = String(935_000_000_000_000n + BigInt(Math.floor(Math.random() * 1_000_000_000)));
  const room = String(640_000_000_000_000_000n + BigInt(Math.floor(Math.random() * 1e9)));
  const player = '650000000000000001';
  const rival = '650000000000000002';
  const privacy = new PrivacyRegistry();
  const handlers = new Map<string, JobHandler>();
  const replies: string[] = [];
  const sent: string[] = [];
  const edits: string[] = [];
  const reactions: string[] = [];
  const files: string[] = [];
  const removed: string[] = [];
  const scheduled: { kind: string; key?: string }[] = [];
  const question = { question: 'Who thought up the demon?', answers: ['Maxwell'], choices: [] };
  const config = gamesConfig.parse({ trivia: { questions: [question] } });

  const text = (message: Outgoing) =>
    typeof message === 'string' ? message : (message.content ?? message.embeds?.[0]?.description);
  const schedule = async (kind: string, input: { dedupeKey?: string }) => {
    scheduled.push({ kind, key: input.dedupeKey });
    return null;
  };
  const said = (content: string, bot = false): IncomingMessage =>
    ({
      id: String(Date.now()),
      channelId: room,
      guildId: guild,
      content,
      author: { id: player, username: 'p', displayName: 'P', bot, avatarUrl: '' },
      fromWebhook: false,
    }) as unknown as IncomingMessage;
  const command = (): GuildContext =>
    ({
      guildId: guild,
      message: said('m!trivia'),
      reply: async (message: Outgoing) => {
        replies.push(text(message) ?? 'embed');
        return '1';
      },
    }) as unknown as GuildContext;

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'games', migrations: definition.migrations },
    ]);
    services = {
      sql,
      privacy,
      log: createLogger('silent', false),
      platform: {
        on: () => {},
        reply: async (_m: IncomingMessage, message: Outgoing) => {
          replies.push(text(message) ?? '');
          return '1';
        },
        send: async (_c: string, message: Outgoing) => {
          sent.push(text(message) ?? '');
          return '1';
        },
        edit: async (_c: string, _m: string, message: Outgoing) => {
          edits.push(text(message) ?? '');
        },
        react: async (_c: string, _m: string, emoji: string) => {
          reactions.push(emoji);
        },
        unreact: async (_c: string, _m: string, emoji: string, userId?: string) => {
          if (userId) removed.push(emoji);
        },
        missingBotPermissions: async () => [],
      },
      voice: { icon: () => '', icons: { inline: () => '', reaction: () => null } },
      jobs: {
        handle: (kind: string, handler: JobHandler) => handlers.set(kind, handler),
        enqueue: async () => null,
      },
      undo: { handle: () => {} },
      settings: {
        config: async (_g: string, key: string, schema: z.ZodType) =>
          key === 'games' ? config : schema.parse({}),
        enabled: async (_g: string, key: string) => key !== 'economy',
      },
    } as unknown as Services;
    service = new Games(services, new Wallets(services));
  });

  afterAll(async () => {
    for (const table of [
      'games_scores',
      'games_duels',
      'games_trivia',
      'games_hilo',
      'games_blackjack',
    ]) {
      await sql`delete from ${sql(table)} where guild_id = ${guild}`;
    }
    await sql.end();
  });

  it('registers privacy', async () => {
    await games.setup?.(createContext(games.definition, services));
    expect(privacy.modules()).toEqual(['games']);
  });

  it('keeps an open question across a restart', async () => {
    await new Trivia(service, schedule).start(command());
    expect((await service.store.trivia(room))?.question).toEqual(question);

    const restarted = new Trivia(service, schedule);
    await restarted.start(command());
    expect(replies.at(-1)).toBe('A question is already open here.');

    scheduled.length = 0;
    expect(await restarted.load()).toBeGreaterThanOrEqual(1);
    expect(scheduled.some((job) => job.kind === 'triviaEnd')).toBe(true);
    await restarted.onMessage(said('maxwell', true));
    await restarted.onMessage(said('newton'));
    expect(await service.store.trivia(room)).not.toBeNull();
    const repliesBefore = replies.length;
    await restarted.onMessage(said('Maxwell!'));
    expect(edits.at(-1)).toContain('**Maxwell**');
    expect(edits.at(-1)).toContain('Who thought up the demon?');
    expect(replies).toHaveLength(repliesBefore);
    expect(reactions.at(-1)).toBe('✅');
    expect(await service.store.trivia(room)).toBeNull();
    expect((await service.store.rank(guild, 'trivia', player, 'wins'))?.row.wins).toBe(1);
  });

  it('times out a question started before the restart', async () => {
    await new Trivia(service, schedule).start(command());
    const open = await service.store.trivia(room);
    if (!open) throw new Error('no session');
    await new Trivia(service, schedule).end(room, open.id);
    expect(edits.at(-1)).toContain("Time's up. It was **Maxwell**.");
    expect(await service.store.trivia(room)).toBeNull();
  });

  it('plays higher or lower with reactions on one message', async () => {
    const hilo = new HigherLower(service, schedule);
    const cmd = {
      guildId: guild,
      message: said('m!hl'),
      reply: async (message: Outgoing) => {
        replies.push(text(message) ?? '');
        return '880000000000000001';
      },
    } as unknown as GuildContext;
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.4);
    await hilo.start(cmd, undefined);
    expect(reactions.slice(-3)).toEqual(['⬆️', '⬇️', '⏹️']);
    const press = (emoji: string, userId = player): ReactionEvent => ({
      guildId: guild,
      channelId: room,
      messageId: '880000000000000001',
      userId,
      emoji,
      bot: false,
    });

    random.mockReturnValue(0.9);
    await hilo.onReaction(press('⬆️', rival), true);
    expect((await service.store.hilo(guild, player))?.streak).toBe(0);
    await hilo.onReaction(press('⬆'), true);
    expect(removed.at(-1)).toBe('⬆');
    expect(edits.at(-1)).toContain('Right, 1 in a row.');
    await hilo.onReaction(press('⬆'), false);
    expect((await service.store.hilo(guild, player))?.streak).toBe(1);

    await hilo.onReaction(press('⏹️'), true);
    expect(edits.at(-1)).toBe('Stopped at a streak of 1.');
    expect(await service.store.hilo(guild, player)).toBeNull();
    random.mockRestore();
  });

  it('plays a hand of blackjack with reactions and reveals the dealer', async () => {
    const order = ['TH', '9S', '6C', '7D', '5S', 'KC'];
    const table = new Blackjack(service, schedule, {
      deck: () => [...order].reverse(),
      delay: async () => {},
    });
    const cmd = {
      guildId: guild,
      message: said('m!bj'),
      reply: async (message: Outgoing) => {
        replies.push(text(message) ?? '');
        if (typeof message !== 'string') files.push(message.files?.[0]?.name ?? '');
        return '880000000000000002';
      },
    } as unknown as GuildContext;
    await table.start(cmd, undefined);
    expect(replies.at(-1)).toContain('hit');
    expect(files.at(-1)).toBe('blackjack.png');
    const press = (emoji: string, userId = player): ReactionEvent => ({
      guildId: guild,
      channelId: room,
      messageId: '880000000000000002',
      userId,
      emoji,
      bot: false,
    });
    await table.onReaction(press('➕', rival), true);
    expect((await service.store.blackjack(guild, player))?.hands[0]?.cards).toHaveLength(2);
    const before = edits.length;
    await table.onReaction(press('➕'), true);
    expect(await service.store.blackjack(guild, player)).toBeNull();
    expect(edits.length - before).toBe(2);
    expect(edits.at(-1)).toContain('You win.');
    expect((await service.store.rank(guild, 'blackjack', player, 'wins'))?.row.wins).toBe(1);
  });

  it('splits a pair and plays both hands in turn', async () => {
    const order = ['8H', 'TS', '8C', '7D', '3S', '2C', 'KS'];
    const table = new Blackjack(service, schedule, {
      deck: () => [...order].reverse(),
      delay: async () => {},
    });
    const cmd = {
      guildId: guild,
      message: said('m!bj'),
      reply: async (message: Outgoing) => {
        replies.push(text(message) ?? '');
        return '880000000000000003';
      },
    } as unknown as GuildContext;
    await table.start(cmd, undefined);
    expect(reactions.at(-1)).toBe('✂️');
    await table.onMessage(said('split'));
    const split = await service.store.blackjack(guild, player);
    expect(split?.hands.map((hand) => hand.cards)).toEqual([
      ['8H', '3S'],
      ['8C', '2C'],
    ]);
    await table.onMessage(said('hit'));
    expect((await service.store.blackjack(guild, player))?.active).toBe(1);
    await table.onMessage(said('stand'));
    expect(await service.store.blackjack(guild, player)).toBeNull();
    expect(edits.at(-1)).toContain('You win.');
  });

  it('ignores reactions from bots on a duel', async () => {
    const duel = await service.store.createDuel({
      guildId: guild,
      channelId: room,
      challenger: player,
      opponent: rival,
      stake: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const messageId = String(BigInt(duel.id) + 990_000_000_000_000n);
    await service.store.setDuelMessage(duel.id, messageId);
    const coinflip = new Coinflip(service, schedule);
    await coinflip.load();
    const reaction = { guildId: guild, channelId: room, messageId, userId: rival, emoji: '❌' };
    await coinflip.onReaction({ ...reaction, bot: true });
    expect((await service.store.duel(duel.id))?.status).toBe('open');
    await coinflip.onReaction({ ...reaction, bot: false });
    expect((await service.store.duel(duel.id))?.status).toBe('declined');
  });

  it('expires a duel only from a job of its own community', async () => {
    const duel = await service.store.createDuel({
      guildId: guild,
      channelId: room,
      challenger: player,
      opponent: rival,
      stake: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await service.store.setDuelMessage(duel.id, String(BigInt(duel.id) + 991_000_000_000_000n));
    const run = (guildId: string | null) =>
      handlers.get('games.duelExpire')?.({
        id: '0',
        kind: 'games.duelExpire',
        guildId,
        payload: { duelId: duel.id },
        runAt: new Date(),
        attempts: 1,
      });
    await run(String(BigInt(guild) + 1n));
    await run(null);
    expect((await service.store.duel(duel.id))?.status).toBe('open');
    await run(guild);
    expect((await service.store.duel(duel.id))?.status).toBe('expired');
  });
});
