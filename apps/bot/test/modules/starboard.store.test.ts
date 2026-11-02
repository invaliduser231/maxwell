import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/starboard';
import { StarboardStore } from '@maxwell/core/stores/starboard';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('StarboardStore', () => {
  let sql: Sql;
  let store: StarboardStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const id = (n: number) => String((BigInt(guild) % 1_000_000_000_000_000n) * 1_000n + BigInt(n));

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'starboard', migrations: definition.migrations },
    ]);
    store = new StarboardStore(sql);
  });

  afterAll(async () => {
    await sql`delete from starboard_posts where guild_id = ${guild}`;
    await sql.end();
  });

  const input = (n: number, stars: number, author = '300000000000000001') => ({
    messageId: id(n),
    guildId: guild,
    channelId: '200000000000000001',
    authorId: author,
    stars,
    content: `message ${n}`,
  });

  it('upserts counts and links posts', async () => {
    await store.upsert(input(1, 3));
    const row = await store.upsert(input(1, 5));
    expect(row.stars).toBe(5);
    expect(row.postId).toBeNull();
    await store.setPost(guild, id(1), id(101), true);
    expect((await store.byPost(id(101)))?.postImage).toBe(true);
  });

  it('ranks posted messages by stars', async () => {
    await store.upsert(input(2, 9, '300000000000000002'));
    await store.setPost(guild, id(2), id(102));
    await store.upsert(input(3, 20));
    const top = await store.top(guild);
    expect(top.map((row) => row.messageId)).toEqual([id(2), id(1)]);
    expect(await store.stats(guild)).toEqual({ posts: 2, stars: 14 });
    const authors = await store.topAuthors(guild);
    expect(authors[0]).toEqual({ authorId: '300000000000000002', posts: 1, stars: 9 });
  });

  it('clears a post when the board message disappears', async () => {
    expect(await store.clearPost(id(101))).toBe(true);
    expect((await store.get(guild, id(1)))?.postId).toBeNull();
  });

  it('removes rows', async () => {
    expect(await store.remove('900000000000000099', id(3))).toBeNull();
    expect(await store.get('900000000000000099', id(3))).toBeNull();
    expect((await store.remove(guild, id(3)))?.stars).toBe(20);
    expect(await store.remove(guild, id(3))).toBeNull();
    expect((await store.byAuthor(guild, '300000000000000001')).map((row) => row.messageId)).toEqual(
      [id(1)],
    );
    expect(await store.forgetAuthor(guild, '300000000000000001')).toHaveLength(1);
  });
});
