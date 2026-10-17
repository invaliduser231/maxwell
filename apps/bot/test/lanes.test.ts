import { describe, expect, it } from 'vitest';
import { Lanes } from '../src/commands/lanes.js';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('Lanes', () => {
  it('runs tasks of one lane in order and other lanes alongside', async () => {
    const lanes = new Lanes();
    const order: string[] = [];
    const task = (name: string, ms: number) => async () => {
      await wait(ms);
      order.push(name);
    };
    const fail = () => undefined;
    await Promise.all([
      lanes.run('a', task('warn', 30), fail),
      lanes.run('a', task('untimeout', 1), fail),
      lanes.run('b', task('other', 5), fail),
    ]);
    expect(order).toEqual(['other', 'warn', 'untimeout']);
    expect(lanes.size).toBe(0);
  });

  it('keeps going after a failing task and reports it', async () => {
    const lanes = new Lanes();
    const errors: unknown[] = [];
    const ran: string[] = [];
    await Promise.all([
      lanes.run(
        'a',
        async () => {
          throw new Error('boom');
        },
        (error) => errors.push(error),
      ),
      lanes.run(
        'a',
        async () => {
          ran.push('next');
        },
        (error) => errors.push(error),
      ),
    ]);
    expect(ran).toEqual(['next']);
    expect(errors).toHaveLength(1);
  });

  it('stops waiting for a stuck task after the limit', async () => {
    const lanes = new Lanes(20);
    const ran: string[] = [];
    void lanes.run(
      'a',
      () => new Promise<void>(() => undefined),
      () => undefined,
    );
    await lanes.run(
      'a',
      async () => {
        ran.push('second');
      },
      () => undefined,
    );
    expect(ran).toEqual(['second']);
  });
});
