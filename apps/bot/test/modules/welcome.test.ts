import definition, { welcomeConfig } from '@maxwell/core/modules/welcome';
import { describe, expect, it } from 'vitest';
import { delayGroups, gateActive, rulesEmbed } from '../../src/modules/welcome/gate.js';
import { cardVariables, memberVariables, render } from '../../src/modules/welcome/template.js';
import type { GuildRef, UserRef } from '../../src/platform/types.js';

const user: UserRef = {
  id: '300000000000000001',
  username: 'lena_x',
  displayName: 'Lena *',
  bot: false,
  avatarUrl: 'https://example.com/a.png',
};
const guild: GuildRef = { id: '1', name: 'Example', memberCount: 1204, iconUrl: null };

describe('welcome config', () => {
  it('parses an empty object with defaults', () => {
    const config = welcomeConfig.parse({});
    expect(config.join.enabled).toBe(true);
    expect(config.join.channelId).toBeNull();
    expect(config.rules.enabled).toBe(false);
    expect(config.delayedRoles).toEqual([]);
  });

  it('fills nested defaults for partial input', () => {
    const config = welcomeConfig.parse({ join: { channelId: '123456789012345678' } });
    expect(config.join.message).toContain('{user}');
    expect(config.join.channelId).toBe('123456789012345678');
  });

  it('keeps table names prefixed with the module key', () => {
    for (const migration of definition.migrations) {
      const tables = [...migration.up.matchAll(/create table (\w+)/g)].map((m) => m[1]);
      for (const table of tables) expect(table?.startsWith('welcome_')).toBe(true);
    }
  });
});

describe('templates', () => {
  it('replaces known variables and leaves unknown ones', () => {
    const vars = memberVariables(user, guild);
    expect(render('Hi {user}, you are {ordinal}. {nope}', vars)).toBe(
      'Hi <@300000000000000001>, you are 1204th. {nope}',
    );
  });

  it('escapes markdown in names for messages but not for cards', () => {
    expect(memberVariables(user, guild).name).toBe('Lena \\*');
    expect(cardVariables(user, guild).name).toBe('Lena *');
  });

  it('formats counts with separators', () => {
    expect(render('{count}', memberVariables(user, guild))).toBe('1,204');
  });

  it('copes with an unknown guild', () => {
    const vars = memberVariables(user, null);
    expect(render('{server} {count}', vars)).toBe('the server ?');
  });
});

describe('rules gate', () => {
  it('needs both the switch and a role', () => {
    expect(gateActive(welcomeConfig.parse({ rules: { enabled: true } }))).toBe(false);
    expect(
      gateActive(welcomeConfig.parse({ rules: { enabled: true, roleId: '123456789012345678' } })),
    ).toBe(true);
  });

  it('groups delayed roles by delay', () => {
    const config = welcomeConfig.parse({
      delayedRoles: [
        { roleId: '1', delayMinutes: 10 },
        { roleId: '2', delayMinutes: 10 },
        { roleId: '3', delayMinutes: 60 },
        { roleId: '1', delayMinutes: 10 },
      ],
    });
    expect([...delayGroups(config)]).toEqual([
      [10, ['1', '2']],
      [60, ['3']],
    ]);
  });

  it('puts the reaction hint under the rules', () => {
    const embed = rulesEmbed(welcomeConfig.parse({}));
    expect(embed.title).toBe('Rules');
    expect(embed.description?.split('\n').at(-1)).toMatch(/^-# React with .+ to get access\.$/);
  });
});
