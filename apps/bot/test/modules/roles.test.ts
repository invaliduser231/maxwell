import definition, { type RoleMenu, rolesConfig } from '@maxwell/core/modules/roles';
import type { RolesStore } from '@maxwell/core/stores/roles';
import { describe, expect, it, vi } from 'vitest';
import { Recent } from '../../src/modules/roles/cache.js';
import {
  displayEmoji,
  emojiKey,
  normalizeEmoji,
  sameEmoji,
} from '../../src/modules/roles/emoji.js';
import { autoroleIds, nextSweep, tracksMembers } from '../../src/modules/roles/members.js';
import { Menus, menuEmbed } from '../../src/modules/roles/menus.js';
import {
  assignable,
  findEntry,
  menuEmojis,
  planReaction,
  sameSet,
  stickyRoles,
} from '../../src/modules/roles/plan.js';
import type { RoleRef } from '../../src/platform/types.js';
import type { ModuleContext } from '../../src/runtime/module.js';

const red = '100000000000000001';
const blue = '100000000000000002';
const green = '100000000000000003';
const guildId = '900000000000000001';

function menu(type: RoleMenu['type']): RoleMenu {
  return rolesConfig.parse({
    menus: [
      {
        id: 'colors',
        channelId: '200000000000000001',
        type,
        entries: [
          { emoji: '\u{1F534}', roleId: red },
          { emoji: '<:blue:300000000000000001>', roleId: blue },
          { emoji: 'green:300000000000000002', roleId: green, label: 'Green' },
        ],
      },
    ],
  }).menus[0] as RoleMenu;
}

describe('roles config', () => {
  it('parses an empty object', () => {
    const config = rolesConfig.parse({});
    expect(config.menus).toEqual([]);
    expect(config.autoroles.delayMinutes).toBe(0);
    expect(config.sticky.enabled).toBe(false);
  });

  it('rejects duplicate menu ids', () => {
    const result = rolesConfig.safeParse({ menus: [{ id: 'a' }, { id: 'a' }] });
    expect(result.success).toBe(false);
  });

  it('keeps table names prefixed with the module key', () => {
    for (const migration of definition.migrations) {
      const tables = [...migration.up.matchAll(/create table (\w+)/g)].map((m) => m[1]);
      for (const table of tables) expect(table?.startsWith('roles_')).toBe(true);
    }
  });
});

describe('emoji', () => {
  it('normalizes custom emoji forms', () => {
    expect(normalizeEmoji('<:blue:300000000000000001>')).toBe('blue:300000000000000001');
    expect(normalizeEmoji('<a:spin:300000000000000009>')).toBe('spin:300000000000000009');
    expect(normalizeEmoji('blue:300000000000000001')).toBe('blue:300000000000000001');
  });

  it('accepts unicode and rejects words', () => {
    expect(normalizeEmoji('✅')).toBe('✅');
    expect(normalizeEmoji('star')).toBeNull();
    expect(normalizeEmoji('two words')).toBeNull();
    expect(normalizeEmoji('')).toBeNull();
  });

  it('matches custom emojis by id and ignores variation selectors', () => {
    expect(sameEmoji('renamed:300000000000000001', '<:blue:300000000000000001>')).toBe(true);
    expect(sameEmoji('❤️', '❤')).toBe(true);
    expect(emojiKey('<:x:300000000000000001>')).toBe('300000000000000001');
  });

  it('renders custom emojis for messages', () => {
    expect(displayEmoji('blue:300000000000000001')).toBe('<:blue:300000000000000001>');
    expect(displayEmoji('<a:spin:300000000000000009>')).toBe('<a:spin:300000000000000009>');
  });
});

describe('reaction plans', () => {
  it('adds on react and removes on unreact for normal menus', () => {
    const m = menu('normal');
    const entry = findEntry(m, 'blue:300000000000000001');
    expect(entry?.roleId).toBe(blue);
    if (!entry) return;
    expect(planReaction(m, entry, [], true).add).toEqual([blue]);
    expect(planReaction(m, entry, [blue], false).remove).toEqual([blue]);
  });

  it('keeps roles for add-only menus', () => {
    const m = menu('add');
    const entry = findEntry(m, '\u{1F534}');
    if (!entry) throw new Error('entry missing');
    expect(planReaction(m, entry, [red], false)).toEqual({
      add: [],
      remove: [],
      unreact: [],
      temporary: false,
    });
  });

  it('swaps roles and reactions in unique menus', () => {
    const m = menu('unique');
    const entry = findEntry(m, '\u{1F534}');
    if (!entry) throw new Error('entry missing');
    const plan = planReaction(m, entry, [blue, green], true);
    expect(plan.add).toEqual([red]);
    expect(plan.remove).toEqual([blue, green]);
    expect(plan.unreact).toEqual(['blue:300000000000000001', 'green:300000000000000002']);
  });

  it('marks temporary grants', () => {
    const m = menu('temporary');
    const entry = findEntry(m, '\u{1F534}');
    if (!entry) throw new Error('entry missing');
    expect(planReaction(m, entry, [], true).temporary).toBe(true);
  });

  it('gives verify roles and clears the reaction', () => {
    const m = menu('verify');
    const entry = findEntry(m, '\u{1F534}');
    if (!entry) throw new Error('entry missing');
    expect(planReaction(m, entry, [], true)).toEqual({
      add: [red],
      remove: [],
      unreact: ['\u{1F534}'],
      temporary: false,
    });
    expect(planReaction(m, entry, [red], false).remove).toEqual([]);
  });

  it('takes the role away in remove-only menus', () => {
    const m = menu('remove');
    const entry = findEntry(m, '\u{1F534}');
    if (!entry) throw new Error('entry missing');
    expect(planReaction(m, entry, [red], true)).toMatchObject({
      add: [],
      remove: [red],
      unreact: ['\u{1F534}'],
    });
    expect(planReaction(m, entry, [], true)).toMatchObject({ add: [], remove: [] });
  });

  it('keeps the first pick in binding menus', () => {
    const m = menu('binding');
    const entry = findEntry(m, '\u{1F534}');
    if (!entry) throw new Error('entry missing');
    expect(planReaction(m, entry, [], true).add).toEqual([red]);
    expect(planReaction(m, entry, [blue], true)).toMatchObject({
      add: [],
      remove: [],
      unreact: ['\u{1F534}'],
    });
    expect(planReaction(m, entry, [red], false).remove).toEqual([]);
  });

  it('stops at the limit of a limited menu', () => {
    const m = { ...menu('limit'), limit: 2 };
    const entry = findEntry(m, '\u{1F534}');
    if (!entry) throw new Error('entry missing');
    expect(planReaction(m, entry, [blue], true).add).toEqual([red]);
    expect(planReaction(m, entry, [blue, green], true)).toMatchObject({
      add: [],
      unreact: ['\u{1F534}'],
    });
    expect(planReaction(m, entry, [red, blue, green], true)).toMatchObject({
      add: [],
      unreact: [],
    });
    expect(planReaction(m, entry, [red], false).remove).toEqual([red]);
  });

  it('describes the new modes on the menu', () => {
    expect(menuEmbed(menu('verify')).description?.split('\n').at(-1)).toBe(
      '-# React to get the role.',
    );
    expect(
      menuEmbed({ ...menu('limit'), limit: 3 })
        .description?.split('\n')
        .at(-1),
    ).toBe('-# Up to 3 roles.');
  });

  it('lists each emoji once', () => {
    expect(menuEmojis(menu('normal'))).toEqual([
      '\u{1F534}',
      'blue:300000000000000001',
      'green:300000000000000002',
    ]);
  });

  it('builds a menu message with role mentions and a hint', () => {
    const embed = menuEmbed(menu('temporary'));
    expect(embed.description).toContain(`<@&${blue}>`);
    expect(embed.description).toContain('Green');
    expect(embed.description?.split('\n').at(-1)).toBe('-# Roles last 1d.');
  });
});

describe('sticky and autoroles', () => {
  it('filters sticky roles by mode', () => {
    const config = rolesConfig.parse({
      sticky: { enabled: true, mode: 'listed', roleIds: [red, blue], ignoredRoleIds: [blue] },
    }).sticky;
    expect(stickyRoles(config, [green, red, blue, guildId], guildId)).toEqual([red]);
    const all = { ...config, mode: 'all' as const };
    expect(stickyRoles(all, [green, red, blue, guildId], guildId)).toEqual([red, green]);
  });

  it('only restores roles below the bot', () => {
    const roles: RoleRef[] = [
      {
        id: red,
        name: 'red',
        color: 0,
        position: 1,
        permissions: '0',
        managed: false,
        hoist: false,
        mentionable: false,
      },
      {
        id: blue,
        name: 'blue',
        color: 0,
        position: 9,
        permissions: '0',
        managed: false,
        hoist: false,
        mentionable: false,
      },
      {
        id: green,
        name: 'bot',
        color: 0,
        position: 5,
        permissions: '0',
        managed: false,
        hoist: false,
        mentionable: false,
      },
    ];
    expect(assignable([red, blue, '999'], roles, [green], guildId)).toEqual([red]);
    expect(assignable([red, blue], roles, null, guildId)).toEqual([red, blue]);
  });

  it('picks autoroles for humans and bots', () => {
    const config = rolesConfig.parse({ autoroles: { roleIds: [red, red], botRoleIds: [blue] } });
    expect(autoroleIds(config, false)).toEqual([red]);
    expect(autoroleIds(config, true)).toEqual([blue]);
    expect(tracksMembers(config)).toBe(false);
    expect(tracksMembers(rolesConfig.parse({ timeRoles: [{ roleId: red, days: 7 }] }))).toBe(true);
  });

  it('compares role sets', () => {
    expect(sameSet([red, blue], [blue, red])).toBe(true);
    expect(sameSet([red], [red, blue])).toBe(false);
  });

  it('spreads sweeps over the hour and always moves forward', () => {
    const hour = 60 * 60_000;
    const now = Date.UTC(2026, 9, 21, 12, 0, 0);
    const next = nextSweep(guildId, now);
    expect(next).toBeGreaterThan(now);
    expect(next - now).toBeLessThanOrEqual(hour);
    expect(nextSweep(guildId, next)).toBe(next + hour);
    expect(nextSweep(guildId, next - 1)).toBe(next);
  });
});

describe('Recent', () => {
  it('drops the oldest entries and expired ones', () => {
    let now = 0;
    const cache = new Recent<number>(2, 100, () => now);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(2);
    now = 150;
    expect(cache.get('b')).toBeUndefined();
  });
});

describe('Menus', () => {
  function setup(type: RoleMenu['type'], roles: string[]) {
    const config = rolesConfig.parse({
      menus: [{ ...menu(type), id: 'colors' }],
    });
    const calls: string[] = [];
    const platform = {
      member: async () => ({ user: { bot: false }, roles }),
      addRole: async (_g: string, _u: string, role: string) => {
        calls.push(`add ${role}`);
      },
      removeRole: async (_g: string, _u: string, role: string) => {
        calls.push(`remove ${role}`);
      },
      unreact: async (_c: string, _m: string, emoji: string) => {
        calls.push(`unreact ${emoji}`);
      },
    };
    const store = {
      menuByMessage: async () => ({
        guildId,
        menuId: 'colors',
        channelId: '200000000000000001',
        messageId: '700000000000000001',
        emojis: [],
        publishedAt: new Date(),
      }),
      setTemporary: vi.fn(async () => {}),
      removeTemporary: vi.fn(async () => true),
    };
    const schedule = vi.fn(async () => '1');
    const ctx = {
      config: async () => config,
      enabled: async () => true,
      schedule,
      record: vi.fn(async () => '1'),
      services: { platform, log: { warn() {}, info() {}, debug() {}, error() {} } },
    } as unknown as ModuleContext<typeof rolesConfig>;
    const menus = new Menus(ctx, store as unknown as RolesStore);
    const reaction = (emoji: string) => ({
      guildId,
      channelId: '200000000000000001',
      messageId: '700000000000000001',
      userId: '300000000000000005',
      emoji,
      bot: false,
    });
    return { menus, calls, reaction, schedule, store };
  }

  it('swaps a unique role and ignores the echo of its own unreact', async () => {
    const { menus, calls, reaction } = setup('unique', [blue]);
    await menus.onReaction(reaction('\u{1F534}'), true);
    expect(calls).toEqual([`remove ${blue}`, 'unreact blue:300000000000000001', `add ${red}`]);
    calls.length = 0;
    await menus.onReaction(reaction('blue:300000000000000001'), false);
    expect(calls).toEqual([]);
  });

  it('handles a reaction that arrives twice only once', async () => {
    const { menus, calls, reaction } = setup('normal', []);
    await Promise.all([
      menus.onReaction(reaction('\u{1F534}'), true),
      menus.onReaction(reaction('\u{1F534}'), true),
    ]);
    await menus.onReaction(reaction('\u{1F534}'), true);
    expect(calls).toEqual([`add ${red}`]);
  });

  it('takes a swapped emoji again after its echo was skipped', async () => {
    const roles = [blue];
    const { menus, calls, reaction } = setup('unique', roles);
    await menus.onReaction(reaction('blue:300000000000000001'), true);
    await menus.onReaction(reaction('\u{1F534}'), true);
    roles.splice(0, roles.length, red);
    await menus.onReaction(reaction('blue:300000000000000001'), false);
    calls.length = 0;
    await menus.onReaction(reaction('blue:300000000000000001'), true);
    expect(calls).toEqual([`remove ${red}`, 'unreact \u{1F534}', `add ${blue}`]);
  });

  it('schedules the end of a temporary role', async () => {
    const { menus, calls, reaction, schedule, store } = setup('temporary', []);
    await menus.onReaction(reaction('green:300000000000000002'), true);
    expect(calls).toEqual([`add ${green}`]);
    expect(store.setTemporary).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledWith(
      'temp.expire',
      expect.objectContaining({
        guildId,
        payload: { userId: '300000000000000005', roleId: green },
      }),
    );
  });

  it('ignores emojis that are not on the menu', async () => {
    const { menus, calls, reaction } = setup('normal', []);
    await menus.onReaction(reaction('\u{1F600}'), true);
    expect(calls).toEqual([]);
  });
});
