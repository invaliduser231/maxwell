import { describe, expect, it } from 'vitest';
import {
  cleanTemplateTopic,
  isTemplateData,
  type SnapshotData,
  sanitizeTemplate,
  TEMPLATE_ROLE_LIMIT,
} from '../src/modules/backups.js';

const guild = '900000000000000100';
const member = '300000000000000777';
const bot = '900000000000000199';

function snapshot(): SnapshotData {
  return {
    version: 2,
    roles: [
      {
        id: guild,
        name: '@everyone',
        color: 0,
        position: 0,
        permissions: String(1n << 10n),
        hoist: false,
        mentionable: false,
      },
      {
        id: '900000000000000101',
        name: 'Member',
        color: 0x3a9eea,
        position: 1,
        permissions: String(1n << 11n),
        hoist: false,
        mentionable: true,
      },
      {
        id: '900000000000000102',
        name: 'Mod',
        color: 0xec5b78,
        position: 3,
        permissions: String(1n << 13n),
        hoist: true,
        mentionable: null,
      },
      {
        id: bot,
        name: 'Maxwell',
        color: 0,
        position: 2,
        permissions: String(1n << 3n),
        hoist: false,
        mentionable: false,
      },
    ],
    channels: [
      {
        id: '900000000000000201',
        name: 'Talk',
        type: 4,
        parentId: null,
        position: 1,
        topic: null,
        userLimit: null,
        nsfw: null,
        overwrites: [
          { id: guild, type: 'role', allow: '0', deny: String(1n << 10n) },
          { id: '900000000000000101', type: 'role', allow: String(1n << 10n), deny: '0' },
        ],
      },
      {
        id: '900000000000000202',
        name: 'general',
        type: 0,
        parentId: '900000000000000201',
        position: 0,
        topic: `Ask <@${member}> or <@!${member}>, ping <@&900000000000000102>, see <#900000000000000203>, id ${member}`,
        userLimit: null,
        nsfw: true,
        rateLimitPerUser: 30,
        overwrites: [
          { id: member, type: 'member', allow: String(1n << 11n), deny: '0' },
          { id: bot, type: 'role', allow: String(1n << 11n), deny: '0' },
          { id: '900000000000000999', type: 'role', allow: String(1n << 11n), deny: '0' },
          { id: '900000000000000102', type: 'role', allow: String(1n << 13n), deny: '0' },
        ],
      },
      {
        id: '900000000000000203',
        name: 'rules',
        type: 0,
        parentId: null,
        position: 0,
        topic: '   ',
        userLimit: null,
        nsfw: false,
        overwrites: null,
      },
      {
        id: '900000000000000204',
        name: 'Lounge',
        type: 2,
        parentId: '900000000000000201',
        position: 2,
        topic: 'ignored',
        userLimit: 8,
        nsfw: null,
        overwrites: [],
      },
      {
        id: '900000000000000205',
        name: 'dm',
        type: 1,
        parentId: null,
        position: 0,
        topic: null,
        userLimit: null,
        nsfw: null,
        overwrites: null,
      },
    ],
    modules: { invites: { enabled: true, config: { logChannelId: '900000000000000203' } } },
  };
}

describe('sanitizeTemplate', () => {
  const data = sanitizeTemplate(guild, snapshot(), { skipRoles: new Set([bot]) });
  const json = JSON.stringify(data);

  it('keeps no ids of the source community or its members', () => {
    expect(json).not.toMatch(/\d{15,}/);
    expect(json).not.toContain(member);
    expect(json).not.toContain(guild);
    expect(json).not.toContain('modules');
    expect(json).not.toContain('logChannelId');
  });

  it('orders roles from the top and leaves out @everyone and managed roles', () => {
    expect(data.roles.map((role) => role.name)).toEqual(['Mod', 'Member']);
    expect(data.roles[0]).toEqual({
      key: 'r1',
      name: 'Mod',
      color: 0xec5b78,
      permissions: String(1n << 13n),
      hoist: true,
      mentionable: false,
    });
    expect(data.everyone).toBe(String(1n << 10n));
  });

  it('keeps only overwrites for roles inside the template', () => {
    const general = data.channels.find((channel) => channel.name === 'general');
    expect(general?.overwrites).toEqual([{ target: 'r1', allow: String(1n << 13n), deny: '0' }]);
    const talk = data.channels.find((channel) => channel.name === 'Talk');
    expect(talk?.overwrites).toEqual([
      { target: 'everyone', allow: '0', deny: String(1n << 10n) },
      { target: 'r2', allow: String(1n << 10n), deny: '0' },
    ]);
  });

  it('drops member mentions and bare ids from topics', () => {
    const general = data.channels.find((channel) => channel.name === 'general');
    expect(general?.topic).toBe('Ask or , ping @Mod, see #rules, id');
    expect(data.channels.find((channel) => channel.name === 'rules')?.topic).toBeNull();
  });

  it('keeps the channel tree, types and settings', () => {
    expect(data.channels.map((channel) => [channel.key, channel.name, channel.parentKey])).toEqual([
      ['c1', 'Talk', null],
      ['c2', 'general', 'c1'],
      ['c3', 'rules', null],
      ['c4', 'Lounge', 'c1'],
    ]);
    const general = data.channels.find((channel) => channel.name === 'general');
    expect(general).toMatchObject({ nsfw: true, rateLimitPerUser: 30, type: 0 });
    const lounge = data.channels.find((channel) => channel.name === 'Lounge');
    expect(lounge).toMatchObject({ topic: null, userLimit: 8, nsfw: false, rateLimitPerUser: 0 });
    expect(isTemplateData(data)).toBe(true);
  });

  it('caps the number of roles', () => {
    const many = snapshot();
    many.roles = Array.from({ length: TEMPLATE_ROLE_LIMIT + 5 }, (_, index) => ({
      id: String(800000000000000000n + BigInt(index)),
      name: `r${index}`,
      color: 0,
      position: index,
      permissions: 'oops',
      hoist: null,
      mentionable: null,
    }));
    const capped = sanitizeTemplate(guild, many);
    expect(capped.roles).toHaveLength(TEMPLATE_ROLE_LIMIT);
    expect(capped.roles.every((role) => role.permissions === '0')).toBe(true);
    expect(capped.everyone).toBeNull();
  });
});

describe('cleanTemplateTopic', () => {
  it('replaces known mentions and removes the rest', () => {
    const roles = new Map([['11', 'Crew']]);
    const channels = new Map([['22', 'news']]);
    expect(cleanTemplateTopic('<@&11> and <@&12> in <#22>', roles, channels)).toBe(
      '@Crew and in #news',
    );
    expect(cleanTemplateTopic(`<@${member}>`, roles, channels)).toBeNull();
    expect(cleanTemplateTopic(null, roles, channels)).toBeNull();
  });
});
