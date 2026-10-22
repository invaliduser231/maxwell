import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/suggestions';
import { SuggestionStore } from '@maxwell/core/stores/suggestions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('SuggestionStore', () => {
  let sql: Sql;
  let store: SuggestionStore;
  const randomId = () =>
    String(BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)));
  const guild = randomId();
  const input = {
    guildId: guild,
    channelId: '510000000000000001',
    authorId: '520000000000000001',
    upEmoji: 'up',
    downEmoji: 'down',
  };

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'suggestions', migrations: definition.migrations },
    ]);
    store = new SuggestionStore(sql);
  });

  afterAll(async () => {
    await sql`delete from suggestions_items where guild_id = ${guild}`;
    await sql.end();
  });

  it('creates and finds suggestions by message', async () => {
    const created = await store.create({ ...input, content: 'Pet channel' });
    expect(created.status).toBe('open');
    await store.attach(created.id, '530000000000000001');
    expect((await store.byMessage('530000000000000001'))?.id).toBe(created.id);
    expect(await store.get(guild, 'nope')).toBeNull();
  });

  it('numbers suggestions per community, also when they arrive together', async () => {
    const other = randomId();
    const first = await store.create({ ...input, guildId: other, content: 'First elsewhere' });
    expect(first.number).toBe(1);
    const batch = await Promise.all(
      [1, 2, 3, 4].map((n) => store.create({ ...input, guildId: other, content: `Idea ${n}` })),
    );
    expect(batch.map((entry) => entry.number).sort()).toEqual([2, 3, 4, 5]);
    await sql`delete from suggestions_items where guild_id = ${other}`;
  });

  it('counts one vote per member and lets them switch', async () => {
    const created = await store.create({ ...input, content: 'Movie nights' });
    expect(await store.vote(created.id, '540000000000000001', 1)).toEqual({
      up: 1,
      down: 0,
      previous: null,
    });
    expect(await store.vote(created.id, '540000000000000002', 1)).toMatchObject({ up: 2 });
    expect(await store.vote(created.id, '540000000000000001', -1)).toEqual({
      up: 1,
      down: 1,
      previous: 1,
    });
    expect(await store.unvote(created.id, '540000000000000001', 1)).toEqual({
      up: 1,
      down: 1,
      previous: null,
    });
    expect(await store.unvote(created.id, '540000000000000001', -1)).toEqual({
      up: 1,
      down: 0,
      previous: -1,
    });
  });

  it('ranks by net votes', async () => {
    const top = await store.top(guild);
    expect(top[0]?.content).toBe('Movie nights');
    expect(top.map((s) => s.content)).toContain('Pet channel');
  });

  it('changes status and remembers the old one', async () => {
    const [latest] = await store.list(guild, { limit: 1 });
    if (!latest) throw new Error('no suggestion');
    const change = await store.setStatus(
      guild,
      latest.id,
      'declined',
      'Not now',
      '550000000000000001',
    );
    expect(change?.before).toEqual({ status: 'open', reason: null });
    expect(change?.after).toMatchObject({
      status: 'declined',
      reason: 'Not now',
      statusBy: '550000000000000001',
    });
    expect(await store.counts(guild)).toEqual({ open: 1, planned: 0, done: 0, declined: 1 });
    expect((await store.list(guild, { status: 'declined' })).map((s) => s.id)).toEqual([latest.id]);
    expect(await store.setStatus('1', latest.id, 'done', null, null)).toBeNull();
  });

  it('exports and anonymises an author while keeping the suggestion', async () => {
    const author = '520000000000000077';
    const voter = '540000000000000077';
    const created = await store.create({ ...input, authorId: author, content: 'Quiz night' });
    await store.vote(created.id, voter, 1);
    await store.vote(created.id, author, 1);
    const other = await store.create({ ...input, content: 'Bigger emoji' });
    await store.vote(other.id, voter, -1);
    await store.setStatus(guild, other.id, 'planned', null, voter);

    const authored = await store.memberData(guild, author);
    expect(authored.authored.map((s) => s.content)).toEqual(['Quiz night']);
    expect(authored.votes).toMatchObject([{ suggestionId: created.id, vote: 1 }]);
    expect((await store.memberData(guild, voter)).votes).toHaveLength(2);

    const anonymised = await store.forget(guild, author);
    expect(anonymised.map((s) => [s.id, s.authorId])).toEqual([[created.id, null]]);
    const kept = await store.get(guild, created.id);
    expect(kept).toMatchObject({ content: 'Quiz night', authorId: null, up: 1, down: 0 });

    await store.forget(guild, voter);
    expect(await store.get(guild, created.id)).toMatchObject({ up: 0, down: 0 });
    expect(await store.get(guild, other.id)).toMatchObject({
      authorId: input.authorId,
      down: 0,
      status: 'planned',
      statusBy: null,
    });
    expect(await store.memberData(guild, voter)).toEqual({ authored: [], votes: [] });
  });
});
