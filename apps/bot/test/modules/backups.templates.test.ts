import { connect, migrate, type Sql } from '@maxwell/core';
import definition, { sanitizeTemplate, type TemplateData } from '@maxwell/core/modules/backups';
import { BackupStore, TEMPLATES_PER_GUILD } from '@maxwell/core/stores/backups';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';
import {
  applyImport,
  type ImportResult,
  previewImport,
} from '../../src/modules/backups/importer.js';
import {
  EVERYONE,
  mapMaxwellTemplate,
  maxwellTemplateId,
} from '../../src/modules/backups/template.js';
import type { ChannelInput, Platform, RoleEdit, RoleInput } from '../../src/platform/types.js';

const SEND = String(1n << 11n);
const VIEW = String(1n << 10n);

function template(): TemplateData {
  return {
    version: 1,
    everyone: VIEW,
    roles: [
      {
        key: 'r1',
        name: 'Mod',
        color: 0xec5b78,
        permissions: String(1n << 13n),
        hoist: true,
        mentionable: false,
      },
      { key: 'r2', name: 'Member', color: 0, permissions: SEND, hoist: false, mentionable: true },
    ],
    channels: [
      {
        key: 'c1',
        name: 'Talk',
        type: 4,
        parentKey: null,
        topic: null,
        userLimit: null,
        nsfw: false,
        rateLimitPerUser: 0,
        overwrites: [{ target: 'everyone', allow: '0', deny: VIEW }],
      },
      {
        key: 'c2',
        name: 'general',
        type: 0,
        parentKey: 'c1',
        topic: 'Say hi',
        userLimit: null,
        nsfw: true,
        rateLimitPerUser: 10,
        overwrites: [
          { target: 'r2', allow: SEND, deny: '0' },
          { target: 'r9', allow: SEND, deny: '0' },
        ],
      },
      {
        key: 'c3',
        name: 'Lounge',
        type: 2,
        parentKey: 'c1',
        topic: null,
        userLimit: 5,
        nsfw: false,
        rateLimitPerUser: 0,
        overwrites: [],
      },
      {
        key: 'c4',
        name: 'odd',
        type: 99,
        parentKey: null,
        topic: null,
        userLimit: null,
        nsfw: false,
        rateLimitPerUser: 0,
        overwrites: [],
      },
    ],
  };
}

describe('maxwell templates', () => {
  it('reads template codes', () => {
    expect(maxwellTemplateId('template:42')).toBe('42');
    expect(maxwellTemplateId('template:abc')).toBeNull();
    expect(maxwellTemplateId('https://discord.new/abc')).toBeNull();
  });

  it('turns a template into an import plan', () => {
    const plan = mapMaxwellTemplate({
      id: '7',
      title: 'Study group',
      description: '',
      data: template(),
    });
    expect(plan.source).toEqual({
      code: 'template:7',
      name: 'Study group',
      description: null,
      template: '7',
    });
    expect(plan.everyone).toEqual(['ViewChannel']);
    expect(plan.roles.map((role) => [role.key, role.name, role.permissions])).toEqual([
      ['r1', 'Mod', ['ManageMessages']],
      ['r2', 'Member', ['SendMessages']],
    ]);
    expect(plan.channels.map((channel) => channel.name)).toEqual(['Talk', 'general', 'Lounge']);
    const general = plan.channels.find((channel) => channel.key === 'c2');
    expect(general).toMatchObject({
      parentKey: 'c1',
      topic: 'Say hi',
      nsfw: true,
      rateLimitPerUser: 10,
      overwrites: [{ target: 'r2', allow: ['SendMessages'], deny: [] }],
    });
    expect(plan.channels[0]?.overwrites).toEqual([
      { target: EVERYONE, allow: [], deny: ['ViewChannel'] },
    ]);
    expect(plan.channels.find((channel) => channel.key === 'c3')?.userLimit).toBe(5);
    expect(plan.skipped.map((item) => item.name)).toEqual(['odd']);
  });

  it('respects the room left in the community', () => {
    const plan = mapMaxwellTemplate(
      { id: '7', title: 'x', description: 'd', data: template() },
      { roles: 1, channels: 2 },
    );
    expect(plan.roles.map((role) => role.name)).toEqual(['Mod']);
    expect(plan.channels.map((channel) => channel.name)).toEqual(['Talk', 'general']);
    expect(plan.channels[1]?.overwrites).toEqual([]);
    expect(plan.skipped.map((item) => item.name)).toEqual(['Member', 'odd', 'Lounge']);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('template store and import', () => {
  let sql: Sql;
  let store: BackupStore;
  const randomId = () =>
    String(BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)));
  const source = randomId();
  const other = randomId();
  const target = randomId();
  const user = '300000000000000001';

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'backups', migrations: definition.migrations },
    ]);
    store = new BackupStore(sql);
  });

  afterAll(async () => {
    for (const guild of [source, other, target]) {
      await sql`delete from backups_templates where guild_id = ${guild}`;
      await sql`delete from backups_imports where guild_id = ${guild}`;
      await sql`delete from guilds where id = ${guild}`;
    }
    await sql.end();
  });

  it('publishes, lists and limits templates per community', async () => {
    const first = await store.publishTemplate(source, {
      title: 'Club',
      description: 'For clubs',
      guildName: null,
      data: template(),
    });
    expect(first).toMatchObject({ title: 'Club', roleCount: 2, channelCount: 4, uses: 0 });
    for (let index = 1; index < TEMPLATES_PER_GUILD; index++) {
      expect(
        await store.publishTemplate(source, {
          title: `Club ${index}`,
          description: '',
          guildName: 'Source',
          data: template(),
        }),
      ).not.toBeNull();
    }
    expect(
      await store.publishTemplate(source, {
        title: 'One too many',
        description: '',
        guildName: null,
        data: template(),
      }),
    ).toBeNull();
    expect(await store.guildTemplates(source)).toHaveLength(TEMPLATES_PER_GUILD);
    const loaded = await store.template(String(first?.id));
    expect(loaded?.data.roles[0]?.name).toBe('Mod');
    const newest = await store.templates({ sort: 'new', limit: 200 });
    expect(newest.some((row) => String(row.id) === String(first?.id))).toBe(true);
  });

  it('only lets the source community unpublish its own template', async () => {
    const [mine] = await store.guildTemplates(source);
    const id = String(mine?.id);
    expect(await store.removeTemplate(id, other)).toBeNull();
    expect(await store.template(id)).not.toBeNull();
    expect((await store.removeTemplate(id, source))?.title).toBe(mine?.title);
    expect(await store.template(id)).toBeNull();
  });

  it('hides templates of communities Maxwell left', async () => {
    const published = await store.publishTemplate(other, {
      title: 'Gone soon',
      description: '',
      guildName: null,
      data: template(),
    });
    const id = String(published?.id);
    await sql`insert into guilds (id, left_at) values (${other}, now())
      on conflict (id) do update set left_at = now()`;
    expect(await store.template(id)).toBeNull();
    const listed = await store.templates({ sort: 'new', limit: 200 });
    expect(listed.some((row) => String(row.id) === id)).toBe(false);
  });

  it('builds a community from a published template and counts the use', async () => {
    const sanitized = sanitizeTemplate(source, {
      version: 2,
      roles: [
        {
          id: source,
          name: '@everyone',
          color: 0,
          position: 0,
          permissions: VIEW,
          hoist: false,
          mentionable: false,
        },
        {
          id: '11',
          name: 'Crew',
          color: 0,
          position: 1,
          permissions: SEND,
          hoist: false,
          mentionable: false,
        },
      ],
      channels: [
        {
          id: '21',
          name: 'chat',
          type: 0,
          parentId: null,
          position: 0,
          topic: null,
          userLimit: null,
          nsfw: true,
          rateLimitPerUser: 15,
          overwrites: [
            { id: '11', type: 'role', allow: SEND, deny: '0' },
            { id: user, type: 'member', allow: SEND, deny: '0' },
          ],
        },
      ],
      modules: {},
    });
    const published = await store.publishTemplate(target, {
      title: 'Crew space',
      description: '',
      guildName: null,
      data: sanitized,
    });
    const templateId = String(published?.id);

    const created: { roles: RoleInput[]; channels: (ChannelInput & { id: string })[] } = {
      roles: [],
      channels: [],
    };
    let next = 7000;
    const roleEdits: { id: string; edit: RoleEdit }[] = [];
    const platform = {
      roles: async () => [
        {
          id: target,
          name: '@everyone',
          color: 0,
          position: 0,
          permissions: '0',
          managed: false,
          hoist: false,
          mentionable: false,
        },
      ],
      editRole: async (_guild: string, id: string, edit: RoleEdit) => {
        roleEdits.push({ id, edit });
      },
      channels: async () => [],
      createRole: async (_guild: string, input: RoleInput) => {
        created.roles.push(input);
        return String(next++);
      },
      createChannel: async (_guild: string, input: ChannelInput) => {
        const id = String(next++);
        created.channels.push({ ...input, id });
        return id;
      },
    } as unknown as Platform;
    const summaries: string[] = [];
    const deps = {
      platform,
      store,
      record: async (_guild: string, _by: unknown, summary: string, _result: ImportResult) => {
        summaries.push(summary);
      },
      onError: () => {},
    };

    const id = await previewImport(deps, target, `template:${templateId}`, { id: user });
    expect((await store.getImport(target, id))?.status).toBe('previewed');
    const result = await applyImport(deps, target, id, { id: user });
    expect(result?.roles.map((role) => role.name)).toEqual(['Crew']);
    expect(created.channels).toEqual([
      {
        id: expect.any(String),
        name: 'chat',
        type: 0,
        parentId: null,
        topic: undefined,
        userLimit: undefined,
        nsfw: true,
        rateLimitPerUser: 15,
        overwrites: [{ id: result?.roles[0]?.id, type: 'role', allow: ['SendMessages'], deny: [] }],
      },
    ]);
    expect(roleEdits).toEqual([{ id: target, edit: { permissionBits: VIEW } }]);
    expect(summaries).toEqual(['Imported the template Crew space']);
    expect((await store.template(templateId))?.uses).toBe(1);

    await store.removeTemplate(templateId, target);
    const gone = await previewImport(deps, target, `template:${templateId}`, { id: user });
    const row = await store.getImport(target, gone);
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('That template is no longer published.');
  });
});
