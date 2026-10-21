import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/scheduler';
import { MessageStateStore, ReminderStore } from '@maxwell/core/stores/scheduler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('scheduler stores', () => {
  let sql: Sql;
  let reminders: ReminderStore;
  let state: MessageStateStore;
  const randomId = () =>
    String(BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)));
  const guild = randomId();
  const lena = '300000000000000001';
  const channel = '100000000000000001';
  const at = (minutes: number) => new Date(Date.UTC(2030, 0, 1, 12, minutes));

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'scheduler', migrations: definition.migrations },
    ]);
    reminders = new ReminderStore(sql);
    state = new MessageStateStore(sql);
  });

  afterAll(async () => {
    await sql`delete from scheduler_reminders where guild_id = ${guild}`;
    await sql`delete from scheduler_message_state where guild_id = ${guild}`;
    await sql.end();
  });

  it('stores reminders per member in due order', async () => {
    const late = await reminders.create({
      guildId: guild,
      channelId: channel,
      userId: lena,
      content: 'later',
      dueAt: at(30),
    });
    await reminders.create({
      guildId: guild,
      channelId: channel,
      userId: lena,
      content: 'soon',
      dueAt: at(5),
    });
    await reminders.create({
      guildId: guild,
      channelId: channel,
      userId: '300000000000000002',
      content: 'other',
      dueAt: at(10),
    });
    expect((await reminders.forMember(guild, lena)).map((row) => row.content)).toEqual([
      'soon',
      'later',
    ]);
    expect(await reminders.countForMember(guild, lena)).toBe(2);
    expect(late.number).toBe(1);
    expect((await reminders.byNumber(guild, 1))?.id).toBe(late.id);
    expect(await reminders.byNumber(guild, 0)).toBeNull();
    expect((await reminders.forGuild(guild)).map((row) => row.content)).toEqual([
      'soon',
      'other',
      'later',
    ]);
    expect(await reminders.remove(guild, late.id, '300000000000000002')).toBeNull();
    expect((await reminders.remove(guild, late.id, lena))?.content).toBe('later');
    expect(await reminders.get(late.id)).toBeNull();
    expect(await reminders.forgetMember(guild, lena)).toBe(1);
    expect(await reminders.pending(guild)).toHaveLength(1);
  });

  it('numbers reminders per community, also when they arrive together', async () => {
    const other = randomId();
    const base = { guildId: other, channelId: channel, userId: lena, dueAt: at(1) };
    const first = await reminders.create({ ...base, content: 'first' });
    expect(first.number).toBe(1);
    const batch = await Promise.all(
      [1, 2, 3, 4].map((n) => reminders.create({ ...base, content: `reminder ${n}` })),
    );
    expect(batch.map((row) => row.number).sort()).toEqual([2, 3, 4, 5]);
    const third = batch.find((row) => row.number === 3);
    expect((await reminders.byNumber(other, 3))?.id).toBe(third?.id);
    const elsewhere = randomId();
    expect((await reminders.create({ ...base, guildId: elsewhere, content: 'x' })).number).toBe(1);
    await sql`delete from scheduler_reminders where guild_id in (${other}, ${elsewhere})`;
  });

  it('remembers when messages ran and prunes removed ones', async () => {
    await state.planned(guild, 'morning', at(60));
    await state.sent(guild, 'morning', at(60), null, at(120));
    await state.sent(guild, 'morning', at(120), 'Missing Send Messages.', at(180));
    await state.planned(guild, 'gone', null);
    const rows = await state.list(guild);
    expect(rows.map((entry) => entry.messageId)).toEqual(['gone', 'morning']);
    const row = rows.find((entry) => entry.messageId === 'morning');
    expect(row?.lastSentAt?.getTime()).toBe(at(60).getTime());
    expect(row?.lastError).toBe('Missing Send Messages.');
    expect(row?.nextRunAt?.getTime()).toBe(at(180).getTime());
    await state.prune(guild, ['morning']);
    expect((await state.list(guild)).map((entry) => entry.messageId)).toEqual(['morning']);
    await state.prune(guild, []);
    expect(await state.list(guild)).toEqual([]);
  });
});
