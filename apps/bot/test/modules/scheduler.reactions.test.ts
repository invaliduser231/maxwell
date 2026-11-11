import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/scheduler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';
import { Reminders } from '../../src/modules/scheduler/reminders.js';
import type { Outgoing, ReactionEvent } from '../../src/platform/types.js';

const url = process.env.TEST_DATABASE_URL;
const log = createLogger('silent', false);

describe.skipIf(!url)('reminder reactions', () => {
  let sql: Sql;
  let reminders: Reminders;
  const guild = String(BigInt(Date.now()) * 1_000_000n + 7n);
  const channel = '100000000000000021';
  const lena = '300000000000000021';
  const edits: string[] = [];
  const reactions: string[] = [];

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, log, [{ module: 'scheduler', migrations: definition.migrations }]);
    const ctx = {
      services: {
        sql,
        log,
        voice: { icons: { reaction: () => null, inline: () => '' } },
        platform: {
          react: async (_c: string, _m: string, emoji: string) => {
            reactions.push(emoji);
          },
          unreact: async () => {},
          edit: async (_c: string, _m: string, out: Outgoing) => {
            edits.push(typeof out === 'string' ? out : (out.content ?? ''));
          },
        },
      },
      schedule: async () => null,
    };
    reminders = new Reminders(ctx as never);
  });

  afterAll(async () => {
    await sql`delete from scheduler_reminders where guild_id = ${guild}`;
    await sql.end();
  });

  const press = (messageId: string, emoji: string, userId = lena): ReactionEvent => ({
    guildId: guild,
    channelId: channel,
    messageId,
    userId,
    emoji,
    bot: false,
  });

  it('drops a reminder when its owner reacts on the confirmation', async () => {
    const row = await reminders.create({
      guildId: guild,
      channelId: channel,
      userId: lena,
      content: 'stretch',
      dueAt: new Date(Date.now() + 3_600_000),
    });
    await reminders.offerCancel(channel, '810000000000000001', row);
    expect(reactions.at(-1)).toBe('❌');
    await reminders.onReaction(press('810000000000000001', '❌', '300000000000000099'));
    expect(await reminders.store.get(row.id)).not.toBeNull();
    await reminders.onReaction(press('810000000000000001', '❌'));
    expect(await reminders.store.get(row.id)).toBeNull();
    expect(edits.at(-1)).toContain(String(row.number));
  });
});
