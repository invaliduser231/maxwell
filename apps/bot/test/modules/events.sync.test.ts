import type { RsvpStatus } from '@maxwell/core/stores/events';
import { describe, expect, it } from 'vitest';
import { allReactors, dropBots, planRsvps, planVotes } from '../../src/modules/events/sync.js';

function pager(total: number) {
  const ids = Array.from({ length: total }, (_, index) => String(1_000 + index));
  const calls: (string | undefined)[] = [];
  return {
    calls,
    async reactionUsers(_c: string, _m: string, _e: string, limit = 100, after?: string) {
      calls.push(after);
      const start = after ? ids.indexOf(after) + 1 : 0;
      return ids.slice(start, start + limit);
    },
  };
}

describe('reactor paging', () => {
  it('follows the after cursor until a short page', async () => {
    const platform = pager(250);
    const found = await allReactors(platform, 'c', 'm', 'x');
    expect(found.complete).toBe(true);
    expect(found.users).toHaveLength(250);
    expect(new Set(found.users).size).toBe(250);
    expect(platform.calls).toEqual([undefined, '1099', '1199']);
  });

  it('stops at the page cap and says so', async () => {
    const platform = pager(500);
    const found = await allReactors(platform, 'c', 'm', 'x', 2);
    expect(found).toMatchObject({ complete: false });
    expect(found.users).toHaveLength(200);
  });

  it('handles an exact multiple of the page size', async () => {
    const found = await allReactors(pager(200), 'c', 'm', 'x');
    expect(found).toMatchObject({ complete: true });
    expect(found.users).toHaveLength(200);
  });
});

describe('bot filter', () => {
  it('drops the bot itself and unknown bots but trusts stored voters', async () => {
    const reacted = new Map<string, unknown>([
      ['self', [0]],
      ['robot', [0]],
      ['human', [1]],
      ['stored', [1]],
    ]);
    const users: Record<string, { bot: boolean }> = {
      robot: { bot: true },
      human: { bot: false },
      stored: { bot: true },
    };
    await dropBots(
      {
        selfId: 'self',
        user: async (id: string) => (users[id] ? ({ id, ...users[id] } as never) : null),
      },
      reacted,
      new Map([['stored', [1]]]),
    );
    expect([...reacted.keys()]).toEqual(['human', 'stored']);
  });
});

describe('vote reconciliation', () => {
  const map = (entries: [string, number[]][]) => new Map(entries);

  it('adds missed votes and removes withdrawn ones', () => {
    const plan = planVotes(
      map([
        ['lena', [0]],
        ['max', [1]],
      ]),
      map([
        ['lena', [0]],
        ['ada', [2]],
      ]),
      false,
      true,
    );
    expect([...plan.set]).toEqual([
      ['max', []],
      ['ada', [2]],
    ]);
    expect(plan.unreact).toEqual([]);
  });

  it('keeps the stored pick in single choice and removes the extra reaction', () => {
    const plan = planVotes(map([['lena', [1]]]), map([['lena', [0, 1]]]), false, true);
    expect(plan.set.size).toBe(0);
    expect(plan.unreact).toEqual([{ userId: 'lena', option: 0 }]);
  });

  it('moves a single choice vote when the old reaction is gone', () => {
    const plan = planVotes(map([['lena', [1]]]), map([['lena', [2]]]), false, true);
    expect([...plan.set]).toEqual([['lena', [2]]]);
  });

  it('mirrors reactions in multiple choice', () => {
    const plan = planVotes(map([['lena', [0, 1]]]), map([['lena', [1, 2]]]), true, true);
    expect([...plan.set]).toEqual([['lena', [1, 2]]]);
    expect(plan.unreact).toEqual([]);
  });

  it('never removes votes when the reaction list was cut short', () => {
    const plan = planVotes(
      map([
        ['lena', [0]],
        ['max', [0, 1]],
      ]),
      map([['max', [2]]]),
      true,
      false,
    );
    expect([...plan.set]).toEqual([['max', [0, 1, 2]]]);
  });
});

describe('rsvp reconciliation', () => {
  const stored = (entries: [string, RsvpStatus][]) => new Map(entries);
  const reacted = (entries: [string, RsvpStatus[]][]) => new Map(entries);

  it('adds, keeps, moves and clears', () => {
    const plan = planRsvps(
      stored([
        ['lena', 'going'],
        ['max', 'maybe'],
        ['kai', 'no'],
      ]),
      reacted([
        ['lena', ['going', 'no']],
        ['max', ['going']],
        ['ada', ['maybe']],
      ]),
      true,
    );
    expect(plan.set).toEqual([
      { userId: 'max', status: 'going' },
      { userId: 'ada', status: 'maybe' },
    ]);
    expect(plan.clear).toEqual([{ userId: 'kai', status: 'no' }]);
    expect(plan.unreact).toEqual([{ userId: 'lena', status: 'no' }]);
  });

  it('prefers going when a new member reacted twice', () => {
    const plan = planRsvps(stored([]), reacted([['ada', ['no', 'going']]]), true);
    expect(plan.set).toEqual([{ userId: 'ada', status: 'going' }]);
    expect(plan.unreact).toEqual([{ userId: 'ada', status: 'no' }]);
  });

  it('keeps RSVPs without reactions when the list was cut short', () => {
    const plan = planRsvps(stored([['kai', 'going']]), reacted([]), false);
    expect(plan.clear).toEqual([]);
  });
});
