import { connect, migrate, type Sql, silentLogger } from '@maxwell/core';
import definition from '@maxwell/core/modules/suggestions';
import { SuggestionStore } from '@maxwell/core/stores/suggestions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('SuggestionStore paging', () => {
  let sql: Sql;
  let store: SuggestionStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, silentLogger, [
      { module: 'suggestions', migrations: definition.migrations },
    ]);
    store = new SuggestionStore(sql);
  });

  afterAll(async () => {
    await sql`delete from suggestions_items where guild_id = ${guild}`;
    await sql.end();
  });

  it('pages the top list with an offset', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const item = await store.create({
        guildId: guild,
        channelId: '200000000000000001',
        authorId: '310000000000000001',
        content: `idea ${i}`,
        upEmoji: 'u',
        downEmoji: 'd',
      });
      ids.push(item.id);
      for (let v = 0; v <= i; v++) await store.vote(item.id, `31000000000000010${v}`, 1);
    }
    const first = await store.top(guild, { limit: 2 });
    const rest = await store.top(guild, { limit: 2, offset: 2 });
    expect(first.map((item) => item.id)).toEqual([ids[2], ids[1]]);
    expect(rest.map((item) => item.id)).toEqual([ids[0]]);
  });
});
