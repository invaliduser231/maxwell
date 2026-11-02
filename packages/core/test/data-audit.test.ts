import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { type AuditEntry, type AuditInput, openAudit, sealAudit } from '../src/audit/store.js';
import { configureDataKey, isSealed } from '../src/crypto/data.js';

const key = randomBytes(32).toString('base64');
const guild = '900000000000000001';

const edit: AuditInput = {
  guildId: guild,
  actor: { id: '410000000000000009' },
  module: 'moderation',
  action: 'case.reason',
  summary: 'Changed the reason of case #4',
  before: { reason: 'posted a phishing link' },
  after: { reason: 'Phishing in #general' },
  undo: {
    kind: 'moderation.reason',
    payload: { number: 4, reason: 'posted a phishing link', unclaim: false },
  },
};

function stored(input: AuditInput): AuditEntry {
  return {
    id: '1',
    guildId: input.guildId,
    actorId: input.actor.id,
    module: input.module,
    action: input.action,
    summary: input.summary,
    before: input.before ?? null,
    after: input.after ?? null,
    undo: input.undo ?? null,
    createdAt: new Date(0),
    undoneAt: null,
    undoneBy: null,
  };
}

describe('audit reasons', () => {
  afterEach(() => {
    configureDataKey(process.env.DATA_KEY || null);
  });

  it('seals edited case reasons and opens them unchanged', () => {
    configureDataKey(key);
    const sealed = sealAudit(edit);
    expect(isSealed((sealed.before as { reason: string }).reason)).toBe(true);
    expect(isSealed((sealed.after as { reason: string }).reason)).toBe(true);
    expect(isSealed(sealed.undo?.payload.reason)).toBe(true);
    expect(sealed.undo?.kind).toBe('moderation.reason');
    expect(sealed.undo?.payload).toMatchObject({ number: 4, unclaim: false });
    expect(JSON.stringify(sealed).toLowerCase()).not.toContain('phishing');
    expect(openAudit(stored(sealed))).toEqual(stored(edit));
  });

  it('seals void reasons and the reasons of new cases', () => {
    configureDataKey(key);
    const voided = sealAudit({
      ...edit,
      action: 'case.void',
      summary: 'Voided case #4',
      before: undefined,
      after: { case: 4, reason: 'wrong member' },
      undo: { kind: 'moderation.void', payload: { numbers: [4] } },
    });
    expect(voided.before).toBeUndefined();
    expect(isSealed((voided.after as { reason: string }).reason)).toBe(true);
    expect(voided.undo).toEqual({ kind: 'moderation.void', payload: { numbers: [4] } });

    const warned = sealAudit({
      ...edit,
      action: 'case.warn',
      before: undefined,
      after: { case: 5, userId: '1', reason: 'spam', durationSeconds: null },
      undo: null,
    });
    expect(warned.after).toMatchObject({ case: 5, userId: '1', durationSeconds: null });
    expect(openAudit(stored(warned)).after).toEqual({
      case: 5,
      userId: '1',
      reason: 'spam',
      durationSeconds: null,
    });

    const empty = sealAudit({ ...edit, action: 'case.void', after: { case: 4, reason: null } });
    expect(empty.after).toEqual({ case: 4, reason: null });
  });

  it('leaves entries of other actions alone', () => {
    configureDataKey(key);
    const lock: AuditInput = { ...edit, action: 'lock', after: { channelId: '1', reason: 'raid' } };
    expect(sealAudit(lock)).toBe(lock);
    const other: AuditInput = { ...edit, module: 'tickets' };
    expect(sealAudit(other)).toBe(other);
    expect(openAudit(stored(lock))).toEqual(stored(lock));
  });

  it('seals lock, inbox and ticket reasons', () => {
    configureDataKey(key);
    const lock = sealAudit({
      ...edit,
      action: 'channel.lock',
      before: undefined,
      after: { channelId: '1', reason: 'raid', endsAt: null },
      undo: { kind: 'lock', payload: { channelId: '1' } },
    });
    expect(isSealed((lock.after as { reason: string }).reason)).toBe(true);
    expect(openAudit(stored(lock)).after).toEqual({ channelId: '1', reason: 'raid', endsAt: null });

    const resolved = sealAudit({
      ...edit,
      action: 'inbox.resolve',
      before: { status: 'open' },
      after: { status: 'resolved', outcome: 'ban', outcomeCase: 3, note: 'second time' },
      undo: { kind: 'inbox', payload: { item: { number: 2, status: 'claimed', note: 'odd' } } },
    });
    expect(JSON.stringify(resolved)).not.toContain('second time');
    expect(JSON.stringify(resolved)).not.toContain('odd');
    expect(openAudit(stored(resolved))).toEqual(
      stored({
        ...edit,
        action: 'inbox.resolve',
        before: { status: 'open' },
        after: { status: 'resolved', outcome: 'ban', outcomeCase: 3, note: 'second time' },
        undo: { kind: 'inbox', payload: { item: { number: 2, status: 'claimed', note: 'odd' } } },
      }),
    );

    const closed = sealAudit({
      ...edit,
      module: 'tickets',
      action: 'ticket.close',
      before: { status: 'open' },
      after: { status: 'closed', reason: 'my address is here' },
      undo: { kind: 'close', payload: { ticketId: '7' } },
    });
    expect(JSON.stringify(closed)).not.toContain('address');
    expect(openAudit(stored(closed)).after).toEqual({
      status: 'closed',
      reason: 'my address is here',
    });
  });

  it('reads entries written before the key was set', () => {
    configureDataKey(key);
    expect(openAudit(stored(edit))).toEqual(stored(edit));
  });

  it('keeps entries as they are without a key', () => {
    configureDataKey(null);
    expect(JSON.stringify(sealAudit(edit))).toBe(JSON.stringify(edit));
    expect(openAudit(stored(edit))).toEqual(stored(edit));
  });
});
