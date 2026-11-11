import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/collection';
import { CollectionStore } from '@maxwell/core/stores/collection';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('CollectionStore', () => {
  let sql: Sql;
  let store: CollectionStore;
  const randomId = () =>
    String(BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)));
  const guild = randomId();
  const a = '500000000000000001';
  const b = '500000000000000002';
  const channel = '510000000000000001';
  const later = () => new Date(Date.now() + 600_000);

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'collection', migrations: definition.migrations },
    ]);
    store = new CollectionStore(sql);
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

  it('creates deck cards and member cards', async () => {
    const dragon = await store.createCard(guild, {
      deck: 'beasts',
      name: 'Dragon',
      rarity: 'rare',
    });
    expect(dragon.name).toBe('Dragon');
    expect(dragon.number).toBe(1);
    const { card, created } = await store.optIn(guild, a, 'Lena', 'common');
    expect(created).toBe(true);
    expect(card.memberId).toBe(a);
    expect(card.number).toBe(2);
    const again = await store.optIn(guild, a, 'Lena B', 'common');
    expect(again.created).toBe(false);
    expect(again.card.id).toBe(card.id);
    expect(again.card.number).toBe(2);
    expect((await store.cardByNumber(guild, 1))?.id).toBe(dragon.id);
    expect(await store.cardByNumber(guild, 0)).toBeNull();
    const numbered = await store.cardsByNumbers(guild, [1, 2, 99]);
    expect([...numbered.keys()].sort()).toEqual([1, 2]);
    expect(numbered.get(2)?.id).toBe(card.id);
    const pool = await store.pool(guild, ['beasts', 'community']);
    expect(pool).toHaveLength(2);
    expect((await store.findCards(guild, 'dra'))[0]?.id).toBe(dragon.id);
  });

  it('numbers cards per community, also when they arrive together', async () => {
    const other = randomId();
    const first = await store.createCard(other, {
      deck: 'beasts',
      name: 'First',
      rarity: 'common',
    });
    expect(first.number).toBe(1);
    const batch = await Promise.all([
      store.createCard(other, { deck: 'beasts', name: 'Owl', rarity: 'common' }),
      store.createCard(other, { deck: 'beasts', name: 'Fox', rarity: 'common' }),
      store.optIn(other, a, 'Lena', 'common').then((result) => result.card),
      store.optIn(other, b, 'Max', 'common').then((result) => result.card),
    ]);
    expect(batch.map((card) => card.number).sort()).toEqual([2, 3, 4, 5]);
    const third = batch.find((card) => card.number === 3);
    expect((await store.cardByNumber(other, 3))?.id).toBe(third?.id);
    const elsewhere = randomId();
    const own = await store.createCard(elsewhere, { deck: 'x', name: 'Solo', rarity: 'common' });
    expect(own.number).toBe(1);
    await sql`delete from collection_cards where guild_id in (${other}, ${elsewhere})`;
  });

  it('grants cards and reports new ones', async () => {
    const [dragon] = await store.findCards(guild, 'Dragon');
    if (!dragon) throw new Error('missing card');
    const fresh = await store.grant(guild, a, [dragon.id, dragon.id]);
    expect(fresh.has(dragon.id)).toBe(true);
    const again = await store.grant(guild, a, [dragon.id]);
    expect(again.size).toBe(0);
    expect(await store.summary(guild, a)).toEqual({ total: 3, unique: 1 });
    expect((await store.owned(guild, a))[0]?.count).toBe(3);
  });

  it('lets only the first claim a drop', async () => {
    const [dragon] = await store.findCards(guild, 'Dragon');
    if (!dragon) throw new Error('missing card');
    await store.createDrop(guild, channel, dragon.id, later());
    const results = await Promise.all([
      store.claimDrop(guild, channel, a),
      store.claimDrop(guild, channel, b),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('trades only after both confirm and both still own the cards', async () => {
    const lena = await store.memberCard(guild, a);
    const [dragon] = await store.findCards(guild, 'Dragon');
    if (!lena || !dragon) throw new Error('missing card');
    await store.grant(guild, b, [lena.id]);
    const before = await store.ownedCounts(guild, a, [dragon.id]);
    const trade = await store.createTrade({
      guildId: guild,
      channelId: channel,
      fromUser: a,
      toUser: b,
      give: [dragon.id],
      want: [lena.id],
      expiresAt: later(),
    });
    expect(await store.executeTrade(trade.id)).toBe('closed');
    await store.confirmTrade(trade.id, a);
    const both = await store.confirmTrade(trade.id, b);
    expect(both?.fromOk && both.toOk).toBe(true);
    expect(await store.executeTrade(trade.id)).toBe('done');
    expect((await store.ownedCounts(guild, a, [dragon.id])).get(dragon.id)).toBe(
      (before.get(dragon.id) ?? 0) - 1,
    );
    expect((await store.ownedCounts(guild, a, [lena.id])).get(lena.id)).toBeGreaterThan(0);
    expect((await store.ownedCounts(guild, b, [lena.id])).get(lena.id)).toBeUndefined();
  });

  it('lets the receiver answer a one-sided offer with cards of their own', async () => {
    const [dragon] = await store.findCards(guild, 'Dragon');
    if (!dragon) throw new Error('missing card');
    const trade = await store.createTrade({
      guildId: guild,
      channelId: channel,
      fromUser: a,
      toUser: b,
      give: [dragon.id],
      want: [],
      expiresAt: later(),
    });
    await store.confirmTrade(trade.id, b);
    expect(await store.counterTrade(trade.id, a, [dragon.id], later())).toBeNull();
    const countered = await store.counterTrade(trade.id, b, [dragon.id], later());
    expect(countered).toMatchObject({ want: [dragon.id], fromOk: false, toOk: false });
    expect(await store.counterTrade(trade.id, b, [dragon.id], later())).toBeNull();
    await store.closeTrade(trade.id, 'cancelled');
  });

  it('fails a trade when cards are gone', async () => {
    const [dragon] = await store.findCards(guild, 'Dragon');
    if (!dragon) throw new Error('missing card');
    const trade = await store.createTrade({
      guildId: guild,
      channelId: channel,
      fromUser: b,
      toUser: a,
      give: [dragon.id, dragon.id, dragon.id, dragon.id, dragon.id],
      want: [],
      expiresAt: later(),
    });
    await store.confirmTrade(trade.id, a);
    await store.confirmTrade(trade.id, b);
    expect(await store.executeTrade(trade.id)).toBe('missing');
    expect((await store.trade(trade.id))?.status).toBe('failed');
  });

  it('leaves a trade open when closed for another community', async () => {
    const trade = await store.createTrade({
      guildId: guild,
      channelId: channel,
      fromUser: a,
      toUser: b,
      give: [],
      want: [],
      expiresAt: later(),
    });
    expect(await store.closeTrade(trade.id, 'expired', randomId())).toBeNull();
    expect((await store.trade(trade.id))?.status).toBe('open');
    expect((await store.closeTrade(trade.id, 'expired', guild))?.status).toBe('expired');
  });

  it('keeps wishlists bounded', async () => {
    const [dragon] = await store.findCards(guild, 'Dragon');
    if (!dragon) throw new Error('missing card');
    expect(await store.wish(guild, b, dragon.id, 1)).toBe('added');
    expect(await store.wish(guild, b, dragon.id, 1)).toBe('exists');
    expect(await store.wishers(guild, dragon.id)).toEqual([b]);
    expect(await store.unwish(guild, b, dragon.id)).toBe(true);
  });

  it('ranks opted-in members by activity', async () => {
    await store.optIn(guild, b, 'Max', 'common');
    await store.addActivity(guild, new Map([[b, 12]]), new Date().toISOString().slice(0, 10));
    const rows = await store.activity(guild, 30);
    expect(rows[0]?.memberId).toBe(b);
    expect(rows[0]?.messages).toBe(12);
    await store.setRarities(guild, [{ cardId: rows[0]?.cardId ?? '0', rarity: 'legendary' }]);
    expect((await store.memberCard(guild, b))?.rarity).toBe('legendary');
  });

  it('removes a member card on opt out', async () => {
    expect(await store.optOut(guild, b)).toBe(true);
    expect(await store.memberCard(guild, b)).toBeNull();
  });

  it('lists deck cards with owners and sums the overview', async () => {
    const owl = await store.createCard(guild, { deck: 'owls', name: 'Barn owl', rarity: 'common' });
    await store.grant(guild, a, [owl.id, owl.id]);
    const cards = await store.customCards(guild);
    expect(cards.every((card) => card.memberId === null)).toBe(true);
    expect(cards.find((card) => card.id === owl.id)?.owners).toBe(1);
    await store.markSetDone(guild, a, 'owls');
    const overview = await store.overview(guild);
    expect(overview.claimed).toBeGreaterThanOrEqual(2);
    expect(overview.collectors).toBeGreaterThanOrEqual(1);
    expect(overview.sets.owls).toBe(1);
  });
});
