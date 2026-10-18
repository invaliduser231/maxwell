import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/forms';
import { FormStore } from '@maxwell/core/stores/forms';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('FormStore', () => {
  let sql: Sql;
  let store: FormStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const userId = String(410000000000000000n + BigInt(Math.floor(Math.random() * 1e9)));

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'forms', migrations: definition.migrations },
    ]);
    store = new FormStore(sql);
  });

  afterAll(async () => {
    await store.purgeGuild(guild);
    await sql.end();
  });

  it('allows one session per member', async () => {
    const input = {
      guildId: guild,
      formId: 'staff',
      userId,
      mode: 'dm' as const,
      channelId: null,
      questionId: 'a',
      expiresAt: new Date(Date.now() + 60_000),
    };
    const session = await store.startSession(input);
    expect(session?.answers).toEqual({});
    expect(await store.startSession(input)).toBeNull();
    await store.saveProgress(session?.id ?? '', 'b', { a: true, c: null }, new Date());
    expect((await store.session(userId))?.answers).toEqual({ a: true, c: null });
    await store.moveSessionToChannel(session?.id ?? '', '420000000000000001');
    expect((await store.sessionByChannel('420000000000000001'))?.mode).toBe('channel');
    expect((await store.guildSessions(guild)).length).toBe(1);
    expect(await store.endSession(session?.id ?? '')).not.toBeNull();
    expect(await store.endSession(session?.id ?? '')).toBeNull();
  });

  it('numbers submissions per community, also when they arrive together', async () => {
    const other = String(
      BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
    );
    const make = (who: string) =>
      store.createSubmission({
        guildId: other,
        formId: 'x',
        formName: 'X',
        userId: who,
        answers: [],
      });
    const first = await make(userId);
    expect(first.number).toBe(1);
    const batch = await Promise.all([1n, 2n, 3n, 4n].map((n) => make(String(BigInt(userId) + n))));
    expect(batch.map((row) => row.number).sort()).toEqual([2, 3, 4, 5]);
    const third = batch.find((row) => row.number === 3);
    expect((await store.submissionByNumber(other, 3))?.id).toBe(third?.id);
    await sql`delete from forms_submissions where guild_id = ${other}`;
  });

  it('stores submissions, votes and decisions', async () => {
    const submission = await store.createSubmission({
      guildId: guild,
      formId: 'staff',
      formName: 'Staff',
      userId,
      answers: [{ questionId: 'a', label: 'A', type: 'yesno', value: true, display: 'Yes' }],
    });
    expect(submission.status).toBe('pending');
    expect((await store.submissionByNumber(guild, submission.number))?.id).toBe(submission.id);
    expect(await store.submissionByNumber(guild, 0)).toBeNull();
    await store.setReviewMessage(submission.id, '1', String(BigInt(userId) + 7n));
    expect((await store.byReviewMessage(String(BigInt(userId) + 7n)))?.id).toBe(submission.id);

    await store.vote(submission.id, '430000000000000001', 'accept');
    await store.vote(submission.id, '430000000000000002', 'decline');
    await store.vote(submission.id, '430000000000000002', 'accept');
    expect(await store.tally(submission.id)).toEqual({ accept: 2, decline: 0 });
    expect(await store.unvote(submission.id, '430000000000000002', 'decline')).toBe(false);
    expect(await store.unvote(submission.id, '430000000000000002', 'accept')).toBe(true);
    expect(await store.votes(submission.id)).toHaveLength(1);
    expect((await store.votesFor([submission.id])).get(submission.id)).toEqual([
      { userId: '430000000000000001', vote: 'accept' },
    ]);

    expect((await store.history(guild, 'staff', userId)).pending).toBe(1);
    const decided = await store.decide(submission.id, 'accepted', '430000000000000001', 'ok');
    expect(decided?.status).toBe('accepted');
    expect(await store.decide(submission.id, 'declined', null, null)).toBeNull();
    await store.setApplied(submission.id, {
      addedRoleIds: ['1'],
      removedRoleIds: [],
      ticketId: null,
      dmSent: true,
    });
    expect((await store.submission(submission.id))?.applied?.addedRoleIds).toEqual(['1']);
    expect((await store.history(guild, 'staff', userId)).accepted).toBe(1);
    expect(await store.counts(guild)).toEqual([{ formId: 'staff', status: 'accepted', total: 1 }]);
    expect(await store.list(guild, { decided: true, formId: 'staff' })).toHaveLength(1);
    const [time] = await store.reviewTimes(guild);
    expect(time?.formId).toBe('staff');
    expect(time?.medianSeconds).toBeGreaterThanOrEqual(0);

    const reopened = await store.reopen(submission.id);
    expect(reopened?.status).toBe('pending');
    expect(reopened?.applied).toBeNull();
    expect(await store.list(guild, { status: 'pending', formId: 'staff' })).toHaveLength(1);
    expect(await store.list(guild, { decided: true })).toHaveLength(0);
  });

  it('forgets decided submissions and votes but keeps pending ones', async () => {
    const member = String(BigInt(userId) + 11n);
    const voter = String(BigInt(userId) + 12n);
    const make = (formId: string, who: string) =>
      store.createSubmission({
        guildId: guild,
        formId,
        formName: formId,
        userId: who,
        answers: [],
      });
    const decided = await make('a', member);
    await store.setReviewMessage(decided.id, '5', String(BigInt(userId) + 13n));
    await store.decide(decided.id, 'declined', voter, null);
    const open = await make('b', member);
    const other = await make('c', voter);
    await store.vote(other.id, member, 'decline');
    const stillOpen = await make('d', voter);
    await store.vote(stillOpen.id, member, 'accept');
    await store.decide(other.id, 'accepted', null, null);

    expect((await store.memberSubmissions(guild, member)).map((s) => s.id)).toEqual([
      decided.id,
      open.id,
    ]);
    expect((await store.memberVotes(guild, member)).map((v) => v.submissionId)).toEqual([
      other.id,
      stillOpen.id,
    ]);

    const result = await store.forgetMember(guild, member);
    expect(result).toEqual({
      submissions: 1,
      votes: 1,
      kept: 1,
      reviewMessages: [{ channelId: '5', messageId: String(BigInt(userId) + 13n) }],
    });
    expect((await store.memberSubmissions(guild, member)).map((s) => s.id)).toEqual([open.id]);
    expect((await store.memberVotes(guild, member)).map((v) => v.submissionId)).toEqual([
      stillOpen.id,
    ]);
    expect(await store.forgetMember('1', member)).toMatchObject({ submissions: 0, votes: 0 });
  });
});
