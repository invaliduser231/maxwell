import { connect, migrate, type Sql, silentLogger } from '@maxwell/core';
import definition from '@maxwell/core/modules/giveaways';
import { GiveawayStore } from '@maxwell/core/stores/giveaways';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('GiveawayStore dashboard queries', () => {
  let sql: Sql;
  let store: GiveawayStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, silentLogger, [{ module: 'giveaways', migrations: definition.migrations }]);
    store = new GiveawayStore(sql);
  });

  afterAll(async () => {
    await sql`delete from giveaways_items where guild_id = ${guild}`;
    await sql.end();
  });

  it('lists running giveaways first with entry counts', async () => {
    const base = {
      guildId: guild,
      channelId: '200000000000000001',
      hostId: null,
      winners: 1,
      emoji: 'x',
    };
    const planned = await store.create({
      ...base,
      prize: 'Later',
      startsAt: new Date(Date.now() + 3_600_000),
      endsAt: new Date(Date.now() + 7_200_000),
    });
    const running = await store.create({
      ...base,
      prize: 'Now',
      endsAt: new Date(Date.now() + 86_400_000),
    });
    await store.markRunning(running.id, String(BigInt(guild) + 1n));
    await store.enter(running.id, '310000000000000001', 1);
    await store.enter(running.id, '310000000000000002', 3);

    const active = await store.activeWithEntries(guild);
    expect(active.map((item) => [item.id, item.entries])).toEqual([
      [running.id, 2],
      [planned.id, 0],
    ]);
  });
});
