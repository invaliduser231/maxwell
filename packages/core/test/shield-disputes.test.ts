import { describe, expect, it } from 'vitest';
import {
  checkDecision,
  DISPUTE_NOTE_MAX,
  DISPUTE_WAIT_DAYS,
  disputeEligibility,
  type ListingEntry,
  type ShieldDispute,
} from '../src/stores/shield-disputes.js';

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 1);

function entry(daysAgo: number): ListingEntry {
  return {
    source: 'raid',
    createdAt: new Date(now - daysAgo * DAY),
    expiresAt: new Date(now + (90 - daysAgo) * DAY),
  };
}

function dispute(patch: Partial<ShieldDispute> = {}): ShieldDispute {
  return {
    id: '1',
    userId: '100',
    body: 'I was not part of the raid.',
    status: 'open',
    note: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: new Date(now - 20 * DAY),
    ...patch,
  };
}

describe('disputeEligibility', () => {
  it('reports an open dispute first', () => {
    const open = dispute();
    expect(disputeEligibility([entry(5)], open, now)).toEqual({ kind: 'open', dispute: open });
    expect(disputeEligibility([], open, now).kind).toBe('open');
  });

  it('needs a listing', () => {
    expect(disputeEligibility([], null, now)).toEqual({ kind: 'not-listed', last: null });
    const kept = dispute({ status: 'kept', decidedAt: new Date(now - DAY) });
    expect(disputeEligibility([], kept, now)).toEqual({ kind: 'not-listed', last: kept });
  });

  it('lets a listed user file the first dispute', () => {
    expect(disputeEligibility([entry(3)], null, now)).toEqual({ kind: 'ready', last: null });
  });

  it('makes the user wait after a decision', () => {
    const kept = dispute({ status: 'kept', decidedAt: new Date(now - 2 * DAY) });
    const state = disputeEligibility([entry(10)], kept, now);
    expect(state.kind).toBe('wait');
    if (state.kind === 'wait') {
      expect(state.until.getTime()).toBe(now - 2 * DAY + DISPUTE_WAIT_DAYS * DAY);
    }
  });

  it('ends the wait after the waiting time', () => {
    const kept = dispute({
      status: 'kept',
      decidedAt: new Date(now - DISPUTE_WAIT_DAYS * DAY - 1),
    });
    expect(disputeEligibility([entry(40)], kept, now).kind).toBe('ready');
  });

  it('skips the wait for an entry added after the decision', () => {
    const removed = dispute({ status: 'removed', decidedAt: new Date(now - 5 * DAY) });
    expect(disputeEligibility([entry(2)], removed, now).kind).toBe('ready');
    expect(disputeEligibility([entry(6)], removed, now).kind).toBe('wait');
  });
});

describe('checkDecision', () => {
  it('removes with or without a note', () => {
    expect(checkDecision(dispute(), 'remove', null)).toEqual({
      ok: true,
      status: 'removed',
      note: null,
    });
    expect(checkDecision(dispute(), 'remove', '  Reported by mistake. ')).toEqual({
      ok: true,
      status: 'removed',
      note: 'Reported by mistake.',
    });
  });

  it('keeps only with a note', () => {
    expect(checkDecision(dispute(), 'keep', '   ')).toEqual({ ok: false, error: 'note' });
    expect(checkDecision(dispute(), 'keep', 'Confirmed by two communities.')).toEqual({
      ok: true,
      status: 'kept',
      note: 'Confirmed by two communities.',
    });
  });

  it('limits the note', () => {
    const long = 'a'.repeat(DISPUTE_NOTE_MAX + 1);
    expect(checkDecision(dispute(), 'remove', long)).toEqual({ ok: false, error: 'note' });
  });

  it('decides only open disputes', () => {
    for (const status of ['removed', 'kept'] as const) {
      expect(checkDecision(dispute({ status }), 'remove', null)).toEqual({
        ok: false,
        error: 'closed',
      });
      expect(checkDecision(dispute({ status }), 'keep', 'Still listed.')).toEqual({
        ok: false,
        error: 'closed',
      });
    }
  });
});
