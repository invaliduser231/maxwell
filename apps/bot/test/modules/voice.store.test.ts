import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/voice';
import { VoiceStore } from '@maxwell/core/stores/voice';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('VoiceStore', () => {
  let sql: Sql;
  let store: VoiceStore;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const channel = String(BigInt(guild) + 1n);

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'voice', migrations: definition.migrations },
    ]);
    store = new VoiceStore(sql);
  });

  afterAll(async () => {
    await sql`delete from voice_rooms where guild_id = ${guild}`;
    await sql.end();
  });

  it('creates rooms and tracks members', async () => {
    const room = await store.create({
      channelId: channel,
      guildId: guild,
      lobbyId: '210000000000000001',
      ownerId: '300000000000000001',
      number: 1,
      members: [],
    });
    expect(room.locked).toBe(false);
    await store.setMembers(channel, ['300000000000000001', '300000000000000002']);
    await store.setOwner(channel, '300000000000000002');
    await store.setLocked(channel, true);
    const row = await store.get(channel);
    expect(row).toMatchObject({
      ownerId: '300000000000000002',
      members: ['300000000000000001', '300000000000000002'],
      locked: true,
      number: 1,
    });
    expect(await store.count(guild)).toBe(1);
    expect((await store.listFor([guild])).map((r) => r.channelId)).toEqual([channel]);
    expect(await store.listFor([])).toEqual([]);
  });

  it('removes rooms', async () => {
    expect(await store.remove(channel)).toBe(true);
    expect(await store.remove(channel)).toBe(false);
    expect(await store.list(guild)).toEqual([]);
  });
});
