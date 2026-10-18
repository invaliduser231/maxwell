import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/giveaways';
import { GiveawayStore } from '@maxwell/core/stores/giveaways';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('GiveawayStore', () => {
  let sql: Sql;
  let store: GiveawayStore;
  const randomId = () =>
    String(BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)));
  const guild = randomId();
  const channel = '410000000000000001';
  const later = (hours: number) => new Date(Date.now() + hours * 3_600_000);

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'giveaways', migrations: definition.migrations },
    ]);
    store = new GiveawayStore(sql);
  });

  afterAll(async () => {
    await sql`delete from giveaways_items where guild_id = ${guild}`;
    await sql.end();
  });

  it('runs a giveaway from creation to winners', async () => {
    const created = await store.create({
      guildId: guild,
      channelId: channel,
      hostId: '410000000000000009',
      prize: 'Steam key',
      winners: 2,
      emoji: 'party:1',
      endsAt: later(1),
      minLevel: 3,
      bonus: [{ roleId: '410000000000000005', entries: 2 }],
      description: 'Deluxe edition',
      excludedRoleId: '410000000000000006',
      pingRoleId: '410000000000000007',
      dmWinners: false,
    });
    expect(created.status).toBe('scheduled');
    expect(created.bonus).toEqual([{ roleId: '410000000000000005', entries: 2 }]);
    expect(created).toMatchObject({
      description: 'Deluxe edition',
      excludedRoleId: '410000000000000006',
      pingRoleId: '410000000000000007',
      dmWinners: false,
    });
    expect(await store.enter(created.id, '420000000000000001', 1)).toBe(false);

    expect(await store.markRunning(created.id, '430000000000000001')).toBe(true);
    expect(await store.markRunning(created.id, '430000000000000002')).toBe(false);
    expect((await store.byMessage('430000000000000001'))?.id).toBe(created.id);
    expect((await store.latest(guild, 'running'))?.id).toBe(created.id);

    expect(await store.enter(created.id, '420000000000000001', 1)).toBe(true);
    expect(await store.enter(created.id, '420000000000000002', 3)).toBe(true);
    expect(await store.enter(created.id, '420000000000000003', 1)).toBe(true);
    expect(await store.leave(created.id, '420000000000000003')).toBe(true);
    expect(await store.entries(created.id)).toEqual([
      { userId: '420000000000000001', weight: 1 },
      { userId: '420000000000000002', weight: 3 },
    ]);

    const ended = await store.finish(created.id);
    expect(ended?.status).toBe('ended');
    expect(await store.finish(created.id)).toBeNull();
    expect(await store.enter(created.id, '420000000000000004', 1)).toBe(false);

    await store.addWinners(created.id, ['420000000000000002'], 1);
    await store.addWinners(created.id, ['420000000000000001'], 2);
    expect(await store.lastRound(created.id)).toBe(2);
    expect((await store.winners(created.id)).map((w) => [w.userId, w.round])).toEqual([
      ['420000000000000002', 1],
      ['420000000000000001', 2],
    ]);

    const [history] = await store.history(guild);
    expect(history?.id).toBe(created.id);
    expect(history?.entries).toBe(2);
    expect(history?.winnerIds).toEqual(['420000000000000002', '420000000000000001']);
  });

  it('numbers giveaways per community, also when they arrive together', async () => {
    const other = randomId();
    const base = {
      guildId: other,
      channelId: channel,
      hostId: null,
      winners: 1,
      emoji: 'x',
      endsAt: later(1),
    };
    const first = await store.create({ ...base, prize: 'First' });
    expect(first.number).toBe(1);
    const batch = await Promise.all(
      [1, 2, 3, 4].map((n) => store.create({ ...base, prize: `Prize ${n}` })),
    );
    expect(batch.map((entry) => entry.number).sort()).toEqual([2, 3, 4, 5]);
    const third = batch.find((entry) => entry.number === 3);
    expect((await store.byNumber(other, 3))?.id).toBe(third?.id);
    expect(await store.byNumber(other, 6)).toBeNull();
    expect(await store.byNumber(guild, 0)).toBeNull();
    const elsewhere = await store.create({ ...base, guildId: randomId(), prize: 'Elsewhere' });
    expect(elsewhere.number).toBe(1);
    await sql`delete from giveaways_items where guild_id in (${other}, ${elsewhere.guildId})`;
  });

  it('cancels only open giveaways', async () => {
    const created = await store.create({
      guildId: guild,
      channelId: channel,
      hostId: null,
      prize: 'Art',
      winners: 1,
      emoji: 'x',
      startsAt: later(2),
      endsAt: later(5),
    });
    expect((await store.active(guild)).map((g) => g.id)).toContain(created.id);
    expect((await store.cancel(created.id))?.status).toBe('cancelled');
    expect(await store.cancel(created.id)).toBeNull();
    expect(await store.get(guild, 'abc')).toBeNull();
    expect(await store.get('1', created.id)).toBeNull();
  });

  it('exports and forgets a member', async () => {
    const member = '420000000000000077';
    const running = await store.create({
      guildId: guild,
      channelId: channel,
      hostId: member,
      prize: 'Mug',
      winners: 1,
      emoji: 'x',
      endsAt: later(3),
    });
    await store.markRunning(running.id, '430000000000000077');
    await store.enter(running.id, member, 1);
    await store.enter(running.id, '420000000000000078', 1);
    await store.setWeight(running.id, member, 4);
    expect(await store.entries(running.id)).toContainEqual({ userId: member, weight: 4 });
    await store.addWinners(running.id, [member], 1);

    expect((await store.runningEntered(guild, member)).map((g) => g.id)).toEqual([running.id]);
    const data = await store.memberData(guild, member);
    expect(data.entries).toMatchObject([
      { giveawayId: running.id, number: running.number, prize: 'Mug', weight: 4 },
    ]);
    expect(data.wins).toMatchObject([{ giveawayId: running.id, number: running.number, round: 1 }]);
    expect(data.hosted).toMatchObject([
      { giveawayId: running.id, number: running.number, prize: 'Mug' },
    ]);
    expect(await store.memberData('1', member)).toEqual({ entries: [], wins: [], hosted: [] });

    await store.forget(guild, member);
    expect(await store.memberData(guild, member)).toEqual({ entries: [], wins: [], hosted: [] });
    expect(await store.entries(running.id)).toEqual([{ userId: '420000000000000078', weight: 1 }]);
    expect((await store.get(guild, running.id))?.hostId).toBeNull();
  });
});
