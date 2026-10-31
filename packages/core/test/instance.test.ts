import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { holdInstanceLock } from '../src/db/instance.js';
import { connect, type Sql } from '../src/db/sql.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('instance lock', () => {
  let first: Sql;
  let second: Sql;
  const name = `maxwell.test.${Date.now()}.${Math.random()}`;

  beforeAll(() => {
    first = connect(url as string);
    second = connect(url as string);
  });

  afterAll(async () => {
    await first.end();
    await second.end();
  });

  it('lets a second instance wait until the first one releases', async () => {
    const held = await holdInstanceLock(first, name);
    let waits = 0;
    const pending = holdInstanceLock(second, name, { retryMs: 20, onWait: () => waits++ });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(waits).toBeGreaterThan(0);
    await held.release();
    const next = await pending;
    await next.release();
  });

  it('stops waiting when aborted', async () => {
    const held = await holdInstanceLock(first, name);
    const controller = new AbortController();
    const pending = holdInstanceLock(second, name, { retryMs: 20, signal: controller.signal });
    setTimeout(() => controller.abort(), 60);
    await expect(pending).rejects.toThrow('aborted');
    await held.release();
  });
});
