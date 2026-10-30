import { logEvents, logsConfig } from '@maxwell/core/modules/logs';
import { describe, expect, it } from 'vitest';
import { MessageCache } from '../../src/modules/logs/cache.js';
import { hasIgnoredRole, isIgnoredChannel, routeFor } from '../../src/modules/logs/config.js';
import {
  bulkTranscript,
  channelEmbed,
  deletedEmbed,
  editedEmbed,
  joinEmbed,
  memberRolesEmbed,
  nicknameEmbed,
  roleDiff,
  roleEmbed,
  timeoutEmbed,
  voiceEmbed,
} from '../../src/modules/logs/embeds.js';
import { permissionDiff } from '../../src/modules/logs/permissions.js';
import type { ChannelRef, IncomingMessage, RoleRef, UserRef } from '../../src/platform/types.js';
import { palette } from '../../src/ui/palette.js';

const lena: UserRef = {
  id: '400000000000000001',
  username: 'lena',
  displayName: 'Lena',
  bot: false,
  avatarUrl: 'https://cdn.example/a.png',
};

function message(
  id: string,
  content: string,
  overrides: Partial<IncomingMessage> = {},
): IncomingMessage {
  return {
    id,
    channelId: '700',
    guildId: '900',
    content,
    author: lena,
    memberRoles: ['r1'],
    fromWebhook: false,
    attachments: [],
    embeds: [],
    mentionUsers: [],
    mentionRoles: [],
    mentionEveryone: false,
    replyTo: null,
    createdAt: new Date(Date.UTC(2026, 9, 21, 12)),
    ...overrides,
  };
}

describe('logs config', () => {
  it('parses an empty config with every route present', () => {
    const config = logsConfig.parse({});
    expect(Object.keys(config.routes).sort()).toEqual([...logEvents].sort());
    expect(config.routes.messageDelete).toEqual({ enabled: true, channelId: null });
    expect(config.ignoreBots).toBe(true);
  });

  it('routes to the event channel or the default', () => {
    const config = logsConfig.parse({
      defaultChannelId: '1',
      routes: { voice: { channelId: '2' }, invites: { enabled: false } },
    });
    expect(routeFor(config, 'voice')).toBe('2');
    expect(routeFor(config, 'bans')).toBe('1');
    expect(routeFor(config, 'invites')).toBeNull();
    expect(routeFor(logsConfig.parse({}), 'bans')).toBeNull();
  });

  it('ignores channels, their categories and roles', () => {
    const config = logsConfig.parse({ ignoredChannelIds: ['10', '20'], ignoredRoleIds: ['r9'] });
    expect(isIgnoredChannel(config, '10')).toBe(true);
    expect(isIgnoredChannel(config, '11', '20')).toBe(true);
    expect(isIgnoredChannel(config, '11', '21')).toBe(false);
    expect(hasIgnoredRole(config, ['r1', 'r9'])).toBe(true);
    expect(hasIgnoredRole(config, ['r1'])).toBe(false);
  });
});

describe('message cache', () => {
  it('stays bounded and returns the previous text on edit', () => {
    const cache = new MessageCache(2);
    cache.add(message('1', 'one'));
    cache.add(message('2', 'two'));
    expect(cache.update(message('1', 'one, edited'))).toBe('one');
    cache.add(message('3', 'three'));
    expect(cache.size).toBe(2);
    expect(cache.get('2')).toBeNull();
    expect(cache.take('1')?.content).toBe('one, edited');
    expect(cache.get('1')).toBeNull();
  });

  it('caps each community so a busy one does not push out a quiet one', () => {
    const cache = new MessageCache(10, 3);
    cache.add(message('q1', 'quiet', { guildId: '900000000000000002' }));
    for (let i = 0; i < 8; i++) cache.add(message(`b${i}`, 'busy'));
    expect(cache.get('q1')?.content).toBe('quiet');
    expect(cache.get('b4')).toBeNull();
    expect(cache.get('b7')?.content).toBe('busy');
    expect(cache.size).toBe(4);
    expect(cache.forgetAuthor('900000000000000002', cache.get('q1')?.authorId ?? '')).toBe(1);
    expect(cache.size).toBe(3);
  });

  it('skips direct messages', () => {
    const cache = new MessageCache();
    cache.add(message('1', 'dm', { guildId: null }));
    expect(cache.size).toBe(0);
  });
});

describe('log embeds', () => {
  it('quotes deleted content and keeps ids in the footer', () => {
    const embed = deletedEmbed({
      messageId: '1427000000000000000',
      channelId: '700',
      authorId: lena.id,
      person: { ...lena },
      content: 'first line\nsecond line',
      attachments: ['cat.png'],
    });
    expect(embed.title).toBe('Message deleted');
    expect(embed.color).toBe(palette.danger);
    expect(embed.author?.name).toBe('Lena (@lena)');
    expect(embed.description).toContain('> first line\n> second line');
    expect(embed.description).toContain('`cat.png`');
    expect(embed.footer).toBe(`User ${lena.id} / Message 1427000000000000000`);
  });

  it('says so when the text is gone', () => {
    const embed = deletedEmbed({
      messageId: '1427000000000000000',
      channelId: '700',
      authorId: null,
      person: null,
      content: null,
      attachments: [],
    });
    expect(embed.description).toContain("wasn't in my cache");
    expect(embed.author).toBeUndefined();
  });

  it('shows both sides of an edit, shortened', () => {
    const embed = editedEmbed(
      { message: message('5', 'after'), before: 'x'.repeat(2_000) },
      'x'.repeat(2_000),
    );
    expect(embed.description).toContain('**Before**');
    expect(embed.description).toContain('> after');
    expect((embed.description ?? '').length).toBeLessThan(4_096);
  });

  it('warns about young accounts on join', () => {
    const now = Number((BigInt(lena.id) >> 22n) + 1_420_070_400_000n) + 2 * 3_600_000;
    const embed = joinEmbed({ user: lena, memberCount: 1204, warnIcon: '', now });
    expect(embed.description).toContain('The account is only 2 hours old.');
    expect(embed.footer).toBe(`Member #1,204 / User ${lena.id}`);
  });

  it('lists role changes and skips empty ones', () => {
    const { added, removed } = roleDiff(['a', 'b'], ['b', 'c']);
    expect([added, removed]).toEqual([['c'], ['a']]);
    expect(memberRolesEmbed(lena, [], [])).toBeNull();
    expect(memberRolesEmbed(lena, added, removed)?.description).toContain('**Added** <@&c>');
  });

  it('describes nickname and timeout changes', () => {
    expect(nicknameEmbed(lena, null, 'L').description).toContain('**Before** *no nickname*');
    expect(timeoutEmbed(lena, new Date()).title).toBe('Member timed out');
    expect(timeoutEmbed(lena, null).color).toBe(palette.success);
  });

  it('diffs roles by name, color and permissions', () => {
    const before: RoleRef = {
      id: '1',
      name: 'Mods',
      color: 0,
      position: 3,
      permissions: '8192',
      managed: false,
      hoist: false,
      mentionable: false,
    };
    const after: RoleRef = { ...before, name: 'Moderators', permissions: String(8192n | 4n) };
    const embed = roleEmbed('update', { guildId: '9', role: after, roleId: '1', before });
    expect(embed?.description).toContain('`Mods` to `Moderators`');
    expect(embed?.description).toContain('**Added** Ban Members');
    expect(
      roleEmbed('update', { guildId: '9', role: { ...before, position: 5 }, roleId: '1', before }),
    ).toBeNull();
  });

  it('ignores channel moves without visible changes', () => {
    const channel: ChannelRef = {
      id: '5',
      guildId: '9',
      name: 'general',
      type: 0,
      parentId: null,
      position: 1,
      topic: null,
      nsfw: false,
      userLimit: null,
      rateLimitPerUser: 0,
      overwrites: [],
    };
    expect(
      channelEmbed('update', {
        guildId: '9',
        channel: { ...channel, position: 2 },
        before: channel,
      }),
    ).toBeNull();
    expect(
      channelEmbed('update', {
        guildId: '9',
        channel: { ...channel, name: 'chat' },
        before: channel,
      })?.description,
    ).toContain('`general` to `chat`');
    expect(channelEmbed('create', { guildId: '9', channel, before: null })?.description).toContain(
      '**Type** Text',
    );
    const thread = channelEmbed('create', {
      guildId: '9',
      channel: { ...channel, id: '6', name: '1: Movie night', type: 11, parentId: '5' },
      before: null,
    });
    expect(thread?.title).toBe('Thread created');
    expect(thread?.description).toContain('**Type** Thread');
    expect(thread?.description).toContain('**In** <#5>');
    expect(thread?.description).not.toContain('Category');
  });

  it('names voice moves', () => {
    expect(voiceEmbed({ userId: '1', person: null, channelId: '2', before: null })?.title).toBe(
      'Joined voice',
    );
    expect(voiceEmbed({ userId: '1', person: null, channelId: null, before: '2' })?.title).toBe(
      'Left voice',
    );
    expect(voiceEmbed({ userId: '1', person: null, channelId: '3', before: '2' })?.title).toBe(
      'Moved voice',
    );
    expect(voiceEmbed({ userId: '1', person: null, channelId: null, before: null })).toBeNull();
  });

  it('writes a bulk transcript in order', () => {
    const cache = new MessageCache();
    cache.add(message('2', 'later', { createdAt: new Date(Date.UTC(2026, 0, 1, 12, 5)) }));
    cache.add(message('1', 'earlier', { createdAt: new Date(Date.UTC(2026, 0, 1, 12, 0)) }));
    const text = bulkTranscript([cache.get('2'), cache.get('1')].filter((m) => m !== null));
    expect(text.split('\n')).toEqual([
      `[2026-01-01T12:00:00.000Z] lena (${lena.id}): earlier`,
      `[2026-01-01T12:05:00.000Z] lena (${lena.id}): later`,
    ]);
  });
});

describe('permission diff', () => {
  it('names known bits and notices unknown ones', () => {
    expect(permissionDiff('0', String(1n << 11n))).toEqual({
      added: ['SendMessages'],
      removed: [],
      other: false,
    });
    expect(permissionDiff(String(1n << 51n), '0')).toEqual({ added: [], removed: [], other: true });
    expect(permissionDiff('garbage', '0').other).toBe(false);
  });
});
