import { connect, enqueue, type JobInput, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/scheduler';
import { ReminderStore } from '@maxwell/core/stores/scheduler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';
import scheduler from '../../src/modules/scheduler/index.js';
import type { Platform } from '../../src/platform/types.js';
import { createContext } from '../../src/runtime/module.js';
import { PrivacyRegistry } from '../../src/runtime/privacy.js';
import type { Services } from '../../src/services.js';

const url = process.env.TEST_DATABASE_URL;
const log = createLogger('silent', false);

describe.skipIf(!url)('scheduler privacy', () => {
  let sql: Sql;
  let store: ReminderStore;
  const privacy = new PrivacyRegistry();
  const invalidations: ((payload: string) => void)[] = [];
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const lena = '300000000000000011';
  const max = '300000000000000012';
  const channel = '100000000000000011';
  const dueAt = new Date(Date.UTC(2031, 0, 1, 9, 0));

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, log, [{ module: 'scheduler', migrations: definition.migrations }]);
    store = new ReminderStore(sql);
    const services = {
      log,
      sql,
      platform: { on: () => {}, guildIds: () => [] } as unknown as Platform,
      jobs: {
        handle: () => {},
        enqueue: async (job: JobInput) => enqueue(sql, job),
      },
      privacy,
      settings: {
        onInvalidate: (listener: (payload: string) => void) => invalidations.push(listener),
      },
    } as unknown as Services;
    await scheduler.setup?.(createContext(scheduler.definition, services));
  });

  afterAll(async () => {
    await sql`delete from scheduler_reminders where guild_id = ${guild}`;
    await sql`delete from jobs where guild_id = ${guild}`;
    await sql.end();
  });

  it('exports a member reminders and forgets them with their jobs', async () => {
    const mine = await store.create({
      guildId: guild,
      channelId: channel,
      userId: lena,
      content: 'water the plants',
      dueAt,
    });
    await store.create({ guildId: guild, channelId: channel, userId: max, content: 'call', dueAt });
    const key = `scheduler.reminder:${mine.id}`;
    await enqueue(sql, {
      kind: 'scheduler.reminder',
      guildId: guild,
      runAt: dueAt,
      dedupeKey: key,
      payload: { reminderId: mine.id },
    });

    const { data } = await privacy.export(guild, lena);
    expect(data.scheduler).toEqual({
      reminders: [
        {
          id: mine.id,
          number: mine.number,
          channelId: channel,
          content: 'water the plants',
          dueAt: dueAt.toISOString(),
          createdAt: mine.createdAt.toISOString(),
        },
      ],
    });

    expect(await privacy.forget(guild, lena)).toEqual([]);
    expect(await store.forMember(guild, lena)).toEqual([]);
    expect(await store.forMember(guild, max)).toHaveLength(1);
    expect(await sql`select id from jobs where dedupe_key = ${key}`).toHaveLength(0);
    expect((await privacy.export(guild, lena)).data.scheduler).toBeUndefined();
  });

  it('queues one sync when the scheduler settings change', async () => {
    for (const listener of invalidations) {
      listener(`${guild}:scheduler`);
      listener(`${guild}:scheduler`);
      listener(`${guild}:events`);
      listener(`${guild}:prefix`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    const rows = await sql<{ kind: string }[]>`
      select kind from jobs where guild_id = ${guild} and kind = 'scheduler.sync'
    `;
    expect(rows).toHaveLength(1);
  });
});
