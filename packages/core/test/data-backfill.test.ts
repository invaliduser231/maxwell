import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  pgSealSource,
  type SealRow,
  type SealSource,
  type SealTarget,
  sealRow,
  sealTable,
  sealTargets,
  sealValue,
} from '../src/crypto/backfill.js';
import { DataCipher, isSealed } from '../src/crypto/data.js';
import { connect, type Sql } from '../src/db/sql.js';

const cipher = DataCipher.from(randomBytes(32).toString('base64'));
const guild = '900000000000000001';

const target: SealTarget = {
  table: 'notes',
  key: [{ name: 'id', type: 'bigint' }],
  guild: 'guild_id',
  columns: [{ name: 'body', kind: 'text' }],
};

class MemorySource implements SealSource {
  readonly rows = new Map<number, { guildId: string; body: string | null }>();
  readonly reads: (string[] | null)[] = [];
  writes = 0;
  failOn: number | null = null;

  constructor(count: number) {
    for (let id = 1; id <= count; id++) this.rows.set(id, { guildId: guild, body: `note ${id}` });
  }

  async next(_target: SealTarget, after: string[] | null, limit: number): Promise<SealRow[]> {
    this.reads.push(after);
    const from = after ? Number(after[0]) : 0;
    return [...this.rows]
      .filter(([id, row]) => id > from && row.body !== null && !isSealed(row.body))
      .slice(0, limit)
      .map(([id, row]) => ({
        key: [String(id)],
        guildId: row.guildId,
        values: { body: row.body },
      }));
  }

  async write(_target: SealTarget, row: SealRow, values: Record<string, unknown>) {
    const id = Number(row.key[0]);
    if (this.failOn === id) throw new Error('connection lost');
    const current = this.rows.get(id);
    if (!current || current.body !== row.values.body) return false;
    current.body = values.body as string;
    this.writes++;
    return true;
  }
}

describe('sealTable', () => {
  it('encrypts all rows in batches', async () => {
    const source = new MemorySource(25);
    const progress = await sealTable(source, target, { cipher, batchSize: 10 });
    expect(progress).toEqual({ table: 'notes', scanned: 25, sealed: 25, batches: 3 });
    expect(source.reads).toEqual([null, ['10'], ['20']]);
    for (const [id, row] of source.rows) {
      expect(cipher.decrypt(guild, row.body as string)).toBe(`note ${id}`);
    }
  });

  it('is idempotent', async () => {
    const source = new MemorySource(5);
    await sealTable(source, target, { cipher, batchSize: 2 });
    const before = [...source.rows.values()].map((row) => row.body);
    const again = await sealTable(source, target, { cipher, batchSize: 2 });
    expect(again.sealed).toBe(0);
    expect([...source.rows.values()].map((row) => row.body)).toEqual(before);
  });

  it('resumes after an interruption', async () => {
    const source = new MemorySource(12);
    source.failOn = 7;
    await expect(sealTable(source, target, { cipher, batchSize: 5 })).rejects.toThrow();
    expect(source.writes).toBe(6);
    source.failOn = null;
    const rest = await sealTable(source, target, { cipher, batchSize: 5 });
    expect(rest.sealed).toBe(6);
    expect([...source.rows.values()].every((row) => isSealed(row.body))).toBe(true);
  });

  it('stops when aborted', async () => {
    const source = new MemorySource(30);
    const controller = new AbortController();
    const run = sealTable(source, target, {
      cipher,
      batchSize: 10,
      pauseMs: 60_000,
      signal: controller.signal,
    });
    controller.abort();
    const progress = await run;
    expect(progress.batches).toBe(1);
    expect(progress.sealed).toBe(10);
  });

  it('skips rows changed in the meantime', async () => {
    const source = new MemorySource(3);
    const original = source.write.bind(source);
    source.write = async (t, row, values) => {
      if (row.key[0] === '2') {
        const current = source.rows.get(2);
        if (current) current.body = 'edited';
      }
      return original(t, row, values);
    };
    const progress = await sealTable(source, target, { cipher, batchSize: 10 });
    expect(progress.sealed).toBe(2);
    expect(source.rows.get(2)?.body).toBe('edited');
  });

  it('does nothing without a key', async () => {
    const source = new MemorySource(3);
    const progress = await sealTable(source, target, { cipher: DataCipher.from(null) });
    expect(progress.scanned).toBe(0);
    expect(source.reads).toEqual([]);
  });
});

describe('sealValue', () => {
  it('seals json as a single string', () => {
    const sealed = sealValue(cipher, guild, 'json', [{ filename: 'a.png' }]);
    expect(isSealed(sealed)).toBe(true);
    expect(JSON.parse(cipher.decrypt(guild, sealed as string))).toEqual([{ filename: 'a.png' }]);
    expect(sealValue(cipher, guild, 'json', sealed)).toBe(sealed);
  });

  it('seals sample text and names inside json', () => {
    const [sample] = sealValue(cipher, guild, 'samples', [
      { authorId: '1', content: 'buy now', detail: 'link', byMod: false },
    ]) as { authorId: string; content: string; detail: string }[];
    expect(sample?.authorId).toBe('1');
    expect(cipher.decrypt(guild, sample?.content ?? '')).toBe('buy now');
    const detail = sealValue(cipher, guild, 'name', { name: 'Lena', score: 3 }) as {
      name: string;
      score: number;
    };
    expect(detail.score).toBe(3);
    expect(cipher.decrypt(guild, detail.name)).toBe('Lena');
    expect(sealValue(cipher, guild, 'name', { restored: true })).toEqual({ restored: true });
  });

  it('seals case reasons inside audit entries', () => {
    const after = sealValue(cipher, guild, 'reason', { case: 4, reason: 'wrong member' }) as {
      case: number;
      reason: string;
    };
    expect(after.case).toBe(4);
    expect(cipher.decrypt(guild, after.reason)).toBe('wrong member');
    expect(sealValue(cipher, guild, 'reason', after)).toEqual(after);
    expect(sealValue(cipher, guild, 'reason', { case: 4, reason: null })).toEqual({
      case: 4,
      reason: null,
    });
    const undo = sealValue(cipher, guild, 'undo', {
      kind: 'moderation.reason',
      payload: { number: 4, reason: 'old reason', unclaim: true },
    }) as { kind: string; payload: { number: number; reason: string; unclaim: boolean } };
    expect(undo.kind).toBe('moderation.reason');
    expect(undo.payload.number).toBe(4);
    expect(undo.payload.unclaim).toBe(true);
    expect(cipher.decrypt(guild, undo.payload.reason)).toBe('old reason');
    const voided = { kind: 'moderation.void', payload: { numbers: [4] } };
    expect(JSON.stringify(sealValue(cipher, guild, 'undo', voided))).toBe(JSON.stringify(voided));
  });

  it('only rewrites the audit columns that hold a case reason', () => {
    const audit = sealTargets.find((entry) => entry.table === 'audit_entries');
    expect(audit?.where).toBe(`module = 'moderation' and action like 'case.%'`);
    const values = sealRow(cipher, audit as SealTarget, {
      key: ['1'],
      guildId: guild,
      values: {
        before: null,
        after: { case: 4, reason: 'wrong member' },
        undo: { kind: 'moderation.void', payload: { numbers: [4] } },
      },
    });
    expect(Object.keys(values)).toEqual(['after']);
    expect(cipher.decrypt(guild, (values.after as { reason: string }).reason)).toBe('wrong member');
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('pgSealSource', () => {
  let sql: Sql;
  const table = `seal_probe_${Date.now()}`;
  const probe: SealTarget = {
    table,
    key: [{ name: 'id', type: 'bigint' }],
    guild: 'guild_id',
    columns: [
      { name: 'answers', kind: 'json' },
      { name: 'samples', kind: 'samples' },
      { name: 'detail', kind: 'name' },
    ],
  };

  beforeAll(async () => {
    sql = connect(url as string);
    await sql.unsafe(
      `create table ${table} (id bigint primary key, guild_id bigint not null, answers jsonb, samples jsonb, detail jsonb)`,
    );
  });

  afterAll(async () => {
    await sql.unsafe(`drop table if exists ${table}`);
    await sql.end();
  });

  it('seals json columns and leaves nothing pending', async () => {
    await sql.unsafe(`insert into ${table} values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)`, [
      '1',
      guild,
      { q: 'favourite colour' },
      [{ content: 'hello there', detail: 'word' }],
      { name: 'Nuker', count: 3 },
    ] as never[]);
    const source = pgSealSource(sql);
    const progress = await sealTable(source, probe, { cipher });
    expect(progress.sealed).toBe(1);
    expect(await source.next(probe, null, 10)).toEqual([]);
    const [row] = await sql.unsafe<
      {
        answers: unknown;
        samples: { content: string; detail: string }[];
        detail: { name: string; count: number };
      }[]
    >(`select answers, samples, detail from ${table} where id = 1`);
    expect(JSON.parse(cipher.decrypt(guild, row?.answers as string))).toEqual({
      q: 'favourite colour',
    });
    expect(cipher.decrypt(guild, row?.samples[0]?.content as string)).toBe('hello there');
    expect(cipher.decrypt(guild, row?.samples[0]?.detail as string)).toBe('word');
    expect(cipher.decrypt(guild, row?.detail.name as string)).toBe('Nuker');
    expect(row?.detail.count).toBe(3);
  });
});
