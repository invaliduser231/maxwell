import { describe, expect, it } from 'vitest';
import {
  type DiscordTemplate,
  EVERYONE,
  fetchTemplate,
  mapTemplate,
  parseTemplateCode,
  type TemplateError,
} from '../../src/modules/backups/template.js';

const VIEW = String(1n << 10n);
const SEND = String(1n << 11n);
const SPEAK = String(1n << 21n);

function raw(): unknown {
  return {
    code: 'abcDEF123',
    name: 'Study group',
    description: null,
    usage_count: 4,
    serialized_source_guild: {
      name: 'Study',
      roles: [
        {
          id: 0,
          name: '@everyone',
          permissions: String(BigInt(VIEW) | BigInt(SEND)),
          color: 0,
          hoist: false,
          mentionable: false,
        },
        { id: 1, name: 'Member', permissions: '0', color: 255, hoist: false, mentionable: true },
        {
          id: 2,
          name: 'Tutor',
          permissions: String(1n << 13n),
          color: 0,
          hoist: true,
          mentionable: false,
        },
      ],
      channels: [
        { id: 3, type: 4, name: 'Text', position: 0, parent_id: null, permission_overwrites: [] },
        {
          id: 4,
          type: 0,
          name: 'announcements',
          position: 0,
          topic: 'Read me',
          parent_id: 3,
          permission_overwrites: [
            { id: 0, type: 0, allow: '0', deny: SEND },
            { id: 2, type: 0, allow: SEND, deny: '0' },
            { id: 77, type: 1, allow: SEND, deny: '0' },
          ],
        },
        {
          id: 5,
          type: 2,
          name: 'Lounge',
          position: 1,
          user_limit: 8,
          parent_id: null,
          permission_overwrites: [{ id: 1, type: 0, allow: SPEAK, deny: '0' }],
        },
        { id: 6, type: 13, name: 'Stage', position: 2, parent_id: null },
        { id: 7, type: 99, name: 'Mystery', position: 3, parent_id: null },
        { id: 8, type: 0, name: 'chat', position: 1, parent_id: 3 },
      ],
    },
  };
}

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function template(): Promise<DiscordTemplate> {
  return fetchTemplate('abcDEF123', async () => okResponse(raw()));
}

describe('parseTemplateCode', () => {
  it('accepts links and bare codes', () => {
    expect(parseTemplateCode('https://discord.new/abcDEF123')).toBe('abcDEF123');
    expect(parseTemplateCode('discord.com/template/abcDEF123')).toBe('abcDEF123');
    expect(parseTemplateCode('https://discordapp.com/template/x-1/')).toBe('x-1');
    expect(parseTemplateCode('  abcDEF123 ')).toBe('abcDEF123');
  });

  it('rejects other input', () => {
    expect(parseTemplateCode('https://example.com/template/abc')).toBeNull();
    expect(parseTemplateCode('two words')).toBeNull();
    expect(parseTemplateCode('')).toBeNull();
  });
});

describe('fetchTemplate', () => {
  it('requests the public template endpoint', async () => {
    let called = '';
    await fetchTemplate('abc', async (input) => {
      called = String(input);
      return okResponse(raw());
    });
    expect(called).toBe('https://discord.com/api/v10/guilds/templates/abc');
  });

  it('turns failures into template errors', async () => {
    const reason = async (fetcher: typeof fetch) =>
      fetchTemplate('abc', fetcher).catch((error: TemplateError) => error.reason);
    expect(await reason(async () => okResponse({ message: 'Unknown' }, 404))).toBe('not_found');
    expect(await reason(async () => okResponse({}, 502))).toBe('unavailable');
    expect(await reason(async () => okResponse({ code: 'x' }))).toBe('invalid');
    expect(await reason(async () => new Response('not json'))).toBe('invalid');
    expect(
      await reason(async () => {
        throw new Error('offline');
      }),
    ).toBe('unavailable');
  });
});

describe('mapTemplate', () => {
  it('leaves @everyone alone when the template has no such role', async () => {
    const source = await template();
    const plan = mapTemplate({
      ...source,
      serialized_source_guild: {
        ...source.serialized_source_guild,
        roles: source.serialized_source_guild.roles.filter((role) => role.id !== '0'),
      },
    });
    expect(plan.everyone).toBeNull();
    expect(plan.roles).toHaveLength(2);
  });

  it('maps roles from the top down without @everyone', async () => {
    const plan = mapTemplate(await template());
    expect(plan.source).toEqual({ code: 'abcDEF123', name: 'Study group', description: null });
    expect(plan.everyone).toEqual(['ViewChannel', 'SendMessages']);
    expect(plan.roles.map((role) => role.name)).toEqual(['Tutor', 'Member']);
    expect(plan.roles[0]).toMatchObject({ key: '2', hoist: true, permissions: ['ManageMessages'] });
    expect(plan.roles[1]).toMatchObject({ color: 255, mentionable: true, permissions: [] });
  });

  it('maps channels with categories first and keeps role overwrites', async () => {
    const plan = mapTemplate(await template());
    expect(plan.channels.map((c) => `${c.name}:${c.type}:${c.parentKey}`)).toEqual([
      'Text:4:null',
      'announcements:0:3',
      'Lounge:2:null',
      'chat:0:3',
      'Stage:2:null',
    ]);
    const announcements = plan.channels.find((c) => c.name === 'announcements');
    expect(announcements?.topic).toBe('Read me');
    expect(announcements?.overwrites).toEqual([
      { target: EVERYONE, allow: [], deny: ['SendMessages'] },
      { target: '2', allow: ['SendMessages'], deny: [] },
    ]);
    expect(plan.channels.find((c) => c.name === 'Lounge')?.userLimit).toBe(8);
    expect(plan.skipped).toEqual([
      { kind: 'channel', name: 'Mystery', reason: 'Channel type 99 has no match here' },
    ]);
    expect(plan.droppedPermissions).toEqual(['Speak']);
  });

  it('respects the room left on the server', async () => {
    const plan = mapTemplate(await template(), { roles: 1, channels: 2 });
    expect(plan.roles.map((role) => role.name)).toEqual(['Tutor']);
    expect(plan.channels.map((c) => c.name)).toEqual(['Text', 'announcements']);
    expect(plan.skipped.filter((s) => s.reason === 'Over the limit')).toHaveLength(4);
    const lounge = mapTemplate(await template(), { roles: 0, channels: 10 });
    expect(lounge.channels.find((c) => c.name === 'announcements')?.overwrites).toEqual([
      { target: EVERYONE, allow: [], deny: ['SendMessages'] },
    ]);
  });
});
