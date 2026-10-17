import { connect, ModuleStore, migrate, type Sql } from '@maxwell/core';
import { createCanvas } from '@napi-rs/canvas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CardStyles } from '../src/cards/styles.js';
import { createLogger } from '../src/log.js';

const url = process.env.TEST_DATABASE_URL;
const actor = { id: null };

describe.skipIf(!url)('CardStyles', () => {
  let sql: Sql;
  let styles: CardStyles;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false));
    styles = new CardStyles(sql, new ModuleStore(sql));
  });

  afterAll(async () => {
    await sql`delete from guilds where id = ${guild}`;
    await sql.end();
  });

  it('starts with the default look', async () => {
    const style = await styles.forGuild(guild);
    expect(style.theme.accent).toBe('#F26B3A');
    expect(style.backdrop.kind).toBe('field');
  });

  it('validates accents before saving them', async () => {
    expect(await styles.setAccent(guild, 'nope', actor)).toEqual({ ok: false, reason: 'format' });
    expect(await styles.setAccent(guild, '#17171b', actor)).toEqual({
      ok: false,
      reason: 'contrast',
    });
    expect(await styles.setAccent(guild, '3a9eea', actor)).toEqual({ ok: true, accent: '#3A9EEA' });
    expect((await styles.forGuild(guild)).theme.accent).toBe('#3A9EEA');
  });

  it('stores an uploaded background and uses it', async () => {
    const canvas = createCanvas(2400, 1200);
    canvas.getContext('2d').fillRect(0, 0, 2400, 1200);
    expect(await styles.uploadBackground(guild, await canvas.encode('png'), actor)).toEqual({
      ok: true,
    });
    const style = await styles.forGuild(guild);
    expect(style.backdrop.kind).toBe('image');
    if (style.backdrop.kind === 'image') expect(style.backdrop.image.width).toBe(1600);
  });

  it('rejects bytes that are not an image', async () => {
    const result = await styles.uploadBackground(guild, new TextEncoder().encode('hello'), actor);
    expect(result).toEqual({ ok: false, reason: 'decode' });
  });

  it('refuses to fetch from private addresses', async () => {
    expect(await styles.importBackground(guild, 'https://10.20.0.15/x.png', actor)).toEqual({
      ok: false,
      reason: 'source',
    });
  });
});
