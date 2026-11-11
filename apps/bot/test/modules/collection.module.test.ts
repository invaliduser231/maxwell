import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/collection';
import { CollectionStore } from '@maxwell/core/stores/collection';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { createLogger } from '../../src/log.js';
import collection from '../../src/modules/collection/index.js';
import { Collection } from '../../src/modules/collection/service.js';
import { Trades } from '../../src/modules/collection/trades.js';
import { Wallets } from '../../src/modules/economy/wallets.js';
import { createContext } from '../../src/runtime/module.js';
import { PrivacyRegistry } from '../../src/runtime/privacy.js';
import type { JobHandler } from '../../src/runtime/scheduler.js';
import type { Services } from '../../src/services.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('collection module', () => {
  let sql: Sql;
  let store: CollectionStore;
  let services: Services;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const a = '520000000000000001';
  const b = '520000000000000002';
  const channel = '530000000000000001';
  const privacy = new PrivacyRegistry();
  const handlers = new Map<string, JobHandler>();
  const later = () => new Date(Date.now() + 600_000);

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'collection', migrations: definition.migrations },
    ]);
    store = new CollectionStore(sql);
    services = {
      sql,
      privacy,
      log: createLogger('silent', false),
      platform: { on: () => {}, edit: async () => {}, unreact: async () => {} },
      voice: { icon: () => '', icons: { inline: () => '', reaction: () => null } },
      jobs: {
        handle: (kind: string, handler: JobHandler) => handlers.set(kind, handler),
        enqueue: async () => null,
      },
      undo: { handle: () => {} },
      settings: {
        config: async (_g: string, _k: string, schema: z.ZodType) => schema.parse({}),
        enabled: async () => true,
      },
    } as unknown as Services;
    await collection.setup?.(createContext(collection.definition, services));
  });

  afterAll(async () => {
    for (const table of [
      'collection_trades',
      'collection_drops',
      'collection_wishlist',
      'collection_set_rewards',
      'collection_activity',
      'collection_owned',
      'collection_cards',
    ]) {
      await sql`delete from ${sql(table)} where guild_id = ${guild}`;
    }
    await sql.end();
  });

  it('ignores reactions from bots on a trade', async () => {
    const card = await store.createCard(guild, { deck: 'beasts', name: 'Owl', rarity: 'common' });
    await store.grant(guild, a, [card.id]);
    const trade = await store.createTrade({
      guildId: guild,
      channelId: channel,
      fromUser: a,
      toUser: b,
      give: [card.id],
      want: [],
      expiresAt: later(),
    });
    const messageId = String(BigInt(trade.id) + 980_000_000_000_000n);
    await store.setTradeMessage(trade.id, messageId);
    const trades = new Trades(new Collection(services, new Wallets(services)), async () => null);
    await trades.load();
    const reaction = { guildId: guild, channelId: channel, messageId, userId: b, emoji: '❌' };
    await trades.onReaction({ ...reaction, bot: true });
    expect((await store.trade(trade.id))?.status).toBe('open');
    await trades.onReaction({ ...reaction, bot: false });
    expect((await store.trade(trade.id))?.status).toBe('cancelled');
  });

  it('expires a trade only from a job of its own community', async () => {
    const trade = await store.createTrade({
      guildId: guild,
      channelId: channel,
      fromUser: '520000000000000003',
      toUser: '520000000000000004',
      give: [],
      want: [],
      expiresAt: new Date(Date.now() - 1_000),
    });
    await store.setTradeMessage(trade.id, String(BigInt(trade.id) + 981_000_000_000_000n));
    const run = (guildId: string | null) =>
      handlers.get('collection.tradeExpire')?.({
        id: '0',
        kind: 'collection.tradeExpire',
        guildId,
        payload: { tradeId: trade.id },
        runAt: new Date(),
        attempts: 1,
      });
    await run(String(BigInt(guild) + 1n));
    await run(null);
    expect((await store.trade(trade.id))?.status).toBe('open');
    await run(guild);
    expect((await store.trade(trade.id))?.status).toBe('expired');
  });

  it('exports and forgets a member', async () => {
    expect(privacy.modules()).toEqual(['collection']);
    const { card: own } = await store.optIn(guild, a, 'Lena', 'common');
    const [owl] = await store.findCards(guild, 'Owl');
    if (!owl) throw new Error('missing card');
    await store.grant(guild, b, [own.id]);
    await store.wish(guild, a, owl.id, 10);
    await store.markSetDone(guild, a, 'birds');
    await store.addActivity(guild, new Map([[a, 3]]), new Date().toISOString().slice(0, 10));
    await store.createDrop(guild, channel, owl.id, later());
    await store.claimDrop(guild, channel, a);

    const { data, failed } = await privacy.export(guild, a);
    expect(failed).toEqual([]);
    const part = data.collection as {
      card: { name: string; number: number };
      owned: { name: string; count: number; number: number }[];
      wishlist: { name: string; number: number }[];
      sets: { setId: string }[];
      activity: { messages: number }[];
      drops: { number: number | null }[];
      trades: { status: string; proposed: boolean; otherId: string }[];
    };
    expect(part.card).toMatchObject({ name: 'Lena', number: own.number });
    expect(part.owned).toEqual([
      expect.objectContaining({ name: 'Owl', count: 2, number: owl.number }),
    ]);
    expect(part.wishlist.map((row) => [row.name, row.number])).toEqual([['Owl', owl.number]]);
    expect(part.sets.map((row) => row.setId)).toEqual(['birds']);
    expect(part.activity[0]?.messages).toBe(3);
    expect(part.drops).toEqual([expect.objectContaining({ number: owl.number })]);
    expect(part.trades).toEqual([
      expect.objectContaining({ status: 'cancelled', proposed: true, otherId: b }),
    ]);

    expect(await privacy.forget(guild, a)).toEqual([]);
    expect((await privacy.export(guild, a)).data).toEqual({});
    expect(await store.memberCard(guild, a)).toBeNull();
    expect((await store.ownedCounts(guild, b, [own.id])).size).toBe(0);
    expect(await store.owners(guild, owl.id)).toBe(0);
  });
});
