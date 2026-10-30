import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { connect, type Sql } from '../src/db/sql.js';
import { GuildStore } from '../src/guilds/store.js';
import { silentLogger } from '../src/log.js';
import { generalConfig, inviteLink, parseInviteCode } from '../src/modules/general.js';

describe('public page settings', () => {
  it('is off by default', () => {
    expect(generalConfig.parse({}).publicPage).toEqual({
      enabled: false,
      description: '',
      invite: null,
    });
    expect(generalConfig.parse({ publicPage: { enabled: true } }).publicPage).toEqual({
      enabled: true,
      description: '',
      invite: null,
    });
  });

  it('rejects a long description and a broken invite', () => {
    expect(generalConfig.safeParse({ publicPage: { description: 'x'.repeat(301) } }).success).toBe(
      false,
    );
    expect(generalConfig.safeParse({ publicPage: { invite: 'has space' } }).success).toBe(false);
    expect(
      generalConfig.parse({ publicPage: { description: '  hi  ' } }).publicPage.description,
    ).toBe('hi');
  });

  it('reads invite codes from links', () => {
    expect(parseInviteCode('WaO6qGdU')).toBe('WaO6qGdU');
    expect(parseInviteCode(' https://fluxer.gg/WaO6qGdU ')).toBe('WaO6qGdU');
    expect(parseInviteCode('fluxer.gg/abc-12/')).toBe('abc-12');
    expect(parseInviteCode('https://web.fluxer.app/invite/qq11')).toBe('qq11');
    expect(parseInviteCode('https://example.com/abc')).toBeNull();
    expect(parseInviteCode('')).toBeNull();
    expect(parseInviteCode('<script>')).toBeNull();
    expect(inviteLink('qq11')).toBe('https://fluxer.gg/qq11');
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('active guilds', () => {
  let sql: Sql;
  let guilds: GuildStore;
  const guild = String(BigInt(Date.now()) * 1000n + 29n);

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, silentLogger);
    guilds = new GuildStore(sql, 'm!');
  });

  afterAll(async () => {
    await sql`delete from guilds where id = ${guild}`;
    await sql.end();
  });

  it('knows whether Maxwell is still in a community', async () => {
    expect(await guilds.active(guild)).toBe(false);
    await guilds.joined(guild);
    expect(await guilds.active(guild)).toBe(true);
    await guilds.left(guild);
    expect(await guilds.active(guild)).toBe(false);
  });
});
