import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/events';
import { EventStore, PollStore } from '@maxwell/core/stores/events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('events stores', () => {
  let sql: Sql;
  let events: EventStore;
  let polls: PollStore;
  const randomId = () =>
    String(BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)));
  const guild = randomId();
  const lena = '300000000000000001';
  const max = '300000000000000002';
  const start = new Date(Date.UTC(2030, 0, 4, 18, 0));

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'events', migrations: definition.migrations },
    ]);
    events = new EventStore(sql);
    polls = new PollStore(sql);
  });

  afterAll(async () => {
    await sql`delete from events_events where guild_id = ${guild}`;
    await sql`delete from events_polls where guild_id = ${guild}`;
    await sql.end();
  });

  it('numbers events per community, also when they arrive together', async () => {
    const other = randomId();
    const base = { guildId: other, startsAt: start, timezone: 'UTC' };
    const first = await events.create({ ...base, title: 'First' });
    expect(first.number).toBe(1);
    const batch = await Promise.all(
      [1, 2, 3, 4].map((n) => events.create({ ...base, title: `Event ${n}` })),
    );
    expect(batch.map((row) => row.number).sort()).toEqual([2, 3, 4, 5]);
    const third = batch.find((row) => row.number === 3);
    expect((await events.byNumber(other, 3))?.id).toBe(third?.id);
    expect(await events.byNumber(other, 6)).toBeNull();
    expect(await events.byNumber(other, 0)).toBeNull();
    const elsewhere = await events.create({ ...base, guildId: randomId(), title: 'Elsewhere' });
    expect(elsewhere.number).toBe(1);
    await sql`delete from events_events where guild_id in (${other}, ${elsewhere.guildId})`;
  });

  it('numbers polls per community, also when they arrive together', async () => {
    const other = randomId();
    const base = { guildId: other, options: ['Yes', 'No'] };
    const first = await polls.create({ ...base, question: 'First?' });
    expect(first.number).toBe(1);
    const batch = await Promise.all(
      [1, 2, 3, 4].map((n) => polls.create({ ...base, question: `Question ${n}?` })),
    );
    expect(batch.map((row) => row.number).sort()).toEqual([2, 3, 4, 5]);
    const fourth = batch.find((row) => row.number === 4);
    expect((await polls.byNumber(other, 4))?.id).toBe(fourth?.id);
    expect(await polls.byNumber(other, 6)).toBeNull();
    const elsewhere = await polls.create({ ...base, guildId: randomId(), question: 'Elsewhere?' });
    expect(elsewhere.number).toBe(1);
    await sql`delete from events_polls where guild_id in (${other}, ${elsewhere.guildId})`;
  });

  it('creates, finds and updates an event', async () => {
    const row = await events.create({
      guildId: guild,
      title: 'Movie night',
      startsAt: start,
      timezone: 'Europe/Berlin',
      recurrence: 'weekly',
      channelId: '100000000000000001',
    });
    expect(row).toMatchObject({
      guildId: guild,
      sequence: 0,
      status: 'scheduled',
      messageId: null,
    });
    await events.setMessage(row.id, null, '400000000000000001');
    expect((await events.byMessage('400000000000000001'))?.id).toBe(row.id);
    expect(await events.get('1', row.id)).toBeNull();

    const later = new Date(start.getTime() + 3_600_000);
    const moved = await events.update(guild, row.id, { startsAt: later, location: 'Hall' });
    expect(moved?.anchorAt.getTime()).toBe(later.getTime());
    expect(moved?.location).toBe('Hall');
    const renamed = await events.update(guild, row.id, { title: 'Film night' });
    expect(renamed?.anchorAt.getTime()).toBe(later.getTime());
  });

  it('tracks one RSVP per member and occurrence', async () => {
    const [row] = await events.upcoming(guild);
    if (!row) throw new Error('missing event');
    expect(await events.setRsvp(row, lena, 'going')).toBeNull();
    expect(await events.setRsvp(row, lena, 'maybe')).toBe('going');
    await events.setRsvp(row, max, 'going');
    expect(await events.rsvpCounts(row)).toEqual({ going: 1, maybe: 1, no: 0 });
    expect(await events.clearRsvp(row, lena, 'going')).toBe(false);
    expect(await events.clearRsvp(row, lena, 'maybe')).toBe(true);
    expect(await events.rsvpUsers(row, 'going')).toEqual([max]);
    expect((await events.rsvpCountsFor([row])).get(row.id)).toEqual({ going: 1, maybe: 0, no: 0 });

    const advanced = await events.advance(
      row.id,
      row.startsAt,
      new Date(row.startsAt.getTime() + 7 * 86_400_000),
    );
    expect(advanced?.sequence).toBe(1);
    expect(advanced?.messageId).toBeNull();
    if (advanced) expect(await events.rsvpCounts(advanced)).toEqual({ going: 0, maybe: 0, no: 0 });
    expect(await events.advance(row.id, row.startsAt, new Date())).toBeNull();
    expect(await events.forgetMember(guild, max)).toBe(1);
  });

  it('cancels and ends events once', async () => {
    const row = await events.create({
      guildId: guild,
      title: 'Launch',
      startsAt: start,
      timezone: 'UTC',
    });
    expect((await events.finish(row.id, start))?.status).toBe('ended');
    expect(await events.finish(row.id, start)).toBeNull();
    expect((await events.setStatus(guild, row.id, 'cancelled'))?.status).toBe('cancelled');
    const window = await events.between(
      guild,
      new Date(start.getTime() - 1),
      new Date(start.getTime() + 1),
    );
    expect(window.some((event) => event.id === row.id)).toBe(false);
    expect((await events.remove(guild, row.id))?.id).toBe(row.id);
  });

  it('counts poll votes for single choice and toggles', async () => {
    const poll = await polls.create({
      guildId: guild,
      question: 'Lunch?',
      options: ['Pizza', 'Sushi', 'Salad'],
      anonymous: true,
    });
    expect(poll.options).toEqual(['Pizza', 'Sushi', 'Salad']);
    expect((await polls.update(guild, poll.id, { question: 'Lunch today?' }))?.question).toBe(
      'Lunch today?',
    );
    const opened = await polls.open(poll.id, '100000000000000001', '400000000000000002');
    expect(opened?.status).toBe('open');
    expect(await polls.update(guild, poll.id, { question: 'x' })).toBeNull();
    expect((await polls.byMessage('400000000000000002'))?.id).toBe(poll.id);

    expect(await polls.vote(poll, lena, 0, true)).toBe('added');
    expect(await polls.vote(poll, lena, 1, true)).toBe('moved');
    expect(await polls.vote(poll, max, 1, true)).toBe('added');
    expect(await polls.vote(poll, max, 1, true)).toBe('removed');
    expect(await polls.vote(poll, max, 2, false)).toBe('added');
    expect(await polls.vote(poll, max, 2, false)).toBe('kept');
    expect(await polls.results(poll)).toEqual({ counts: [0, 1, 1], voters: 2, votes: 2 });
    expect((await polls.active()).some((row) => row.id === poll.id)).toBe(true);

    expect((await polls.close(guild, poll.id))?.status).toBe('closed');
    expect(await polls.close(guild, poll.id)).toBeNull();
  });

  it('replaces ballots and exports and forgets a member', async () => {
    const poll = await polls.create({
      guildId: guild,
      question: 'Snacks?',
      options: ['Chips', 'Fruit', 'Both'],
      multiple: true,
      createdBy: lena,
    });
    await polls.vote(poll, lena, 0, false);
    await polls.setVotes(poll, lena, [1, 2, 2]);
    await polls.setVotes(poll, max, [0]);
    expect(await polls.ballots(poll.id)).toEqual(
      new Map([
        [lena, [1, 2]],
        [max, [0]],
      ]),
    );
    await polls.setVotes(poll, max, []);
    expect((await polls.ballots(poll.id)).has(max)).toBe(false);

    const votes = await polls.votesOfMember(guild, lena);
    expect(votes.filter((vote) => vote.pollId === poll.id).map((vote) => vote.option)).toEqual([
      1, 2,
    ]);
    expect(votes[0]?.options).toBeInstanceOf(Array);
    expect(await polls.createdBy(guild, lena)).toEqual([
      { id: poll.id, number: poll.number, question: 'Snacks?' },
    ]);
    expect(await polls.forgetCreator(guild, lena)).toBe(1);
    expect(await polls.createdBy(guild, lena)).toEqual([]);
    expect(await polls.forgetMember(guild, lena)).toBeGreaterThanOrEqual(2);
    expect(await polls.votesOfMember(guild, lena)).toEqual([]);
  });

  it('maps and exports RSVPs of the current occurrence', async () => {
    const row = await events.create({
      guildId: guild,
      title: 'Quiz',
      startsAt: start,
      timezone: 'UTC',
      createdBy: lena,
    });
    await events.setRsvp(row, lena, 'going');
    await events.setRsvp(row, max, 'no');
    expect(await events.rsvpMap(row)).toEqual(
      new Map([
        [lena, 'going'],
        [max, 'no'],
      ]),
    );
    const mine = (await events.rsvpsOfMember(guild, lena)).filter((r) => r.eventId === row.id);
    expect(mine).toEqual([
      expect.objectContaining({ title: 'Quiz', status: 'going', current: true, sequence: 0 }),
    ]);
    expect(await events.createdBy(guild, lena)).toContainEqual({
      id: row.id,
      number: row.number,
      title: 'Quiz',
    });
    await events.forgetCreator(guild, lena);
    expect(await events.createdBy(guild, lena)).toEqual([]);
    await events.forgetMember(guild, lena);
    expect(await events.rsvpMap(row)).toEqual(new Map([[max, 'no']]));
  });

  it('allows several picks in multiple choice', async () => {
    const poll = await polls.create({
      guildId: guild,
      question: 'Days?',
      options: ['Fri', 'Sat'],
      multiple: true,
    });
    await polls.vote(poll, lena, 0, false);
    await polls.vote(poll, lena, 1, false);
    expect(await polls.votesOf(poll.id, lena)).toEqual([0, 1]);
    expect(await polls.unvote(poll.id, lena, 0)).toBe(true);
    expect(await polls.results(poll)).toEqual({ counts: [0, 1], voters: 1, votes: 1 });
    expect((await polls.cancel(guild, poll.id))?.status).toBe('cancelled');
    expect(await polls.list(guild, { status: 'cancelled' })).toHaveLength(1);
  });
});
