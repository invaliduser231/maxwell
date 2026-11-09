import type { Actor } from '@maxwell/core';
import type { BackupStore } from '@maxwell/core/stores/backups';
import { describe, expect, it } from 'vitest';
import { audit } from '../../src/modules/backups/copy.js';
import {
  applyImport,
  type ImportDeps,
  type ImportResult,
} from '../../src/modules/backups/importer.js';
import { EVERYONE, type ImportPlan } from '../../src/modules/backups/template.js';
import { permissionBits } from '../../src/platform/permissions.js';
import type {
  ChannelInput,
  Permission,
  Platform,
  RoleEdit,
  RoleInput,
} from '../../src/platform/types.js';

const guild = '900000000000000001';
const user = '300000000000000002';
const asked: Permission[] = [
  'Administrator',
  'ManageGuild',
  'ManageChannels',
  'BanMembers',
  'ManageWebhooks',
];

function takeover(): ImportPlan {
  return {
    source: { code: 'template:9', name: 'Takeover', description: null, template: '9' },
    everyone: ['ViewChannel', 'Administrator', 'ManageGuild'],
    roles: [
      {
        key: 'r1',
        name: 'Boss',
        color: 0,
        hoist: false,
        mentionable: false,
        permissions: ['Administrator', 'BanMembers', 'ManageMessages'],
      },
    ],
    channels: [
      {
        key: 'c1',
        name: 'hooks',
        type: 0,
        parentKey: null,
        topic: null,
        userLimit: null,
        overwrites: [
          { target: EVERYONE, allow: ['ManageWebhooks', 'SendMessages'], deny: ['ManageRoles'] },
          { target: 'r1', allow: ['ManageChannels'], deny: [] },
        ],
      },
    ],
    droppedPermissions: [],
    skipped: [],
  };
}

function harness(options: {
  plan?: ImportPlan;
  everyone?: readonly Permission[];
  holds: (name: Permission) => boolean;
}) {
  const checks: Permission[][] = [];
  const edits: { id: string; edit: RoleEdit }[] = [];
  const roles: RoleInput[] = [];
  const channels: ChannelInput[] = [];
  const recorded: ImportResult[] = [];
  const outcomes: { status: 'applied' | 'failed'; detail: unknown }[] = [];
  const errors: string[] = [];
  const platform = {
    roles: async () => [
      {
        id: guild,
        name: '@everyone',
        color: 0,
        position: 0,
        permissions: permissionBits(options.everyone ?? []),
        managed: false,
        hoist: false,
        mentionable: false,
      },
    ],
    hasPermissions: async (
      _guild: string,
      _user: string,
      _channel: string | null,
      required: readonly Permission[],
    ) => {
      checks.push([...required]);
      return required.every(options.holds);
    },
    editRole: async (_guild: string, id: string, edit: RoleEdit) => {
      edits.push({ id, edit });
    },
    createRole: async (_guild: string, input: RoleInput) => {
      roles.push(input);
      return `70${roles.length}`;
    },
    createChannel: async (_guild: string, input: ChannelInput) => {
      channels.push(input);
      return `80${channels.length}`;
    },
  } as unknown as Platform;
  const store = {
    claimImport: async () => ({ plan: options.plan ?? takeover() }),
    failImport: async (_guild: string, _id: string, error: string) => {
      outcomes.push({ status: 'failed', detail: error });
    },
    finishImport: async (_guild: string, _id: string, result: unknown) => {
      outcomes.push({ status: 'applied', detail: result });
    },
    countTemplateUse: async () => {},
  } as unknown as BackupStore;
  const deps: ImportDeps = {
    platform,
    store,
    record: async (_guild, _by, _summary, result) => {
      recorded.push(result);
    },
    onError: (_error, what) => {
      errors.push(what);
    },
  };
  return {
    checks,
    edits,
    roles,
    channels,
    recorded,
    outcomes,
    errors,
    apply: (by: Actor = { id: user }) => applyImport(deps, guild, '1', by),
  };
}

describe('template import permissions', () => {
  it('applies every permission for the owner or an administrator', async () => {
    const run = harness({ holds: () => true });
    const result = await run.apply();
    expect(run.checks).toEqual([asked]);
    expect(run.edits).toEqual([
      {
        id: guild,
        edit: { permissionBits: permissionBits(['ViewChannel', 'Administrator', 'ManageGuild']) },
      },
    ]);
    expect(result?.everyone?.after).toBe(
      permissionBits(['ViewChannel', 'Administrator', 'ManageGuild']),
    );
    expect(run.roles[0]?.permissions).toEqual(['Administrator', 'BanMembers', 'ManageMessages']);
    expect(run.channels[0]?.overwrites).toEqual([
      { id: guild, type: 'role', allow: ['ManageWebhooks', 'SendMessages'], deny: ['ManageRoles'] },
      { id: '701', type: 'role', allow: ['ManageChannels'], deny: [] },
    ]);
    expect(result).not.toHaveProperty('withheld');
  });

  it('keeps dangerous permissions the editor lacks out of @everyone, roles and overwrites', async () => {
    const run = harness({ holds: (name) => name === 'ManageGuild' });
    const result = await run.apply();
    expect(run.checks).toEqual([asked, ...asked.map((name) => [name])]);
    expect(run.edits).toEqual([
      { id: guild, edit: { permissionBits: permissionBits(['ViewChannel', 'ManageGuild']) } },
    ]);
    expect(result?.everyone).toEqual({
      before: '0',
      after: permissionBits(['ViewChannel', 'ManageGuild']),
    });
    expect(run.roles).toEqual([
      { name: 'Boss', color: 0, permissions: ['ManageMessages'], hoist: false, mentionable: false },
    ]);
    expect(run.channels[0]?.overwrites).toEqual([
      { id: guild, type: 'role', allow: ['SendMessages'], deny: ['ManageRoles'] },
      { id: '701', type: 'role', allow: [], deny: [] },
    ]);
    expect(result?.failed).toEqual([]);
    expect(result?.withheld).toEqual([
      'Administrator',
      'ManageChannels',
      'BanMembers',
      'ManageWebhooks',
    ]);
    expect(run.recorded).toEqual([result]);
    expect(run.outcomes).toEqual([{ status: 'applied', detail: result }]);
  });

  it('looks nothing up when the template grants nothing dangerous', async () => {
    const plan = takeover();
    plan.everyone = ['ViewChannel'];
    plan.roles = plan.roles.map((role) => ({ ...role, permissions: ['ManageMessages'] }));
    plan.channels = plan.channels.map((channel) => ({
      ...channel,
      overwrites: [{ target: EVERYONE, allow: ['SendMessages'], deny: ['ManageRoles'] }],
    }));
    const run = harness({ plan, holds: () => false });
    const result = await run.apply();
    expect(run.checks).toEqual([]);
    expect(run.edits[0]?.edit.permissionBits).toBe(permissionBits(['ViewChannel']));
    expect(run.roles[0]?.permissions).toEqual(['ManageMessages']);
    expect(run.channels[0]?.overwrites).toEqual([
      { id: guild, type: 'role', allow: ['SendMessages'], deny: ['ManageRoles'] },
    ]);
    expect(result).not.toHaveProperty('withheld');
  });

  it('fails the import without writing when the editor cannot be checked', async () => {
    const run = harness({
      holds: () => {
        throw new Error('gone');
      },
    });
    await run.apply();
    expect(run.checks).toEqual([asked]);
    expect(run.edits).toEqual([]);
    expect(run.roles).toEqual([]);
    expect(run.channels).toEqual([]);
    expect(run.recorded).toEqual([]);
    expect(run.errors).toEqual(['apply']);
    expect(run.outcomes).toEqual([{ status: 'failed', detail: audit.importFailed }]);
  });

  it('fails the import without writing when a later check breaks', async () => {
    const run = harness({
      holds: (name) => {
        if (name === 'BanMembers') throw new Error('gone');
        return name === 'ManageGuild';
      },
    });
    await run.apply();
    expect(run.checks).toEqual([
      asked,
      ['Administrator'],
      ['ManageGuild'],
      ['ManageChannels'],
      ['BanMembers'],
    ]);
    expect(run.edits).toEqual([]);
    expect(run.roles).toEqual([]);
    expect(run.channels).toEqual([]);
    expect(run.recorded).toEqual([]);
    expect(run.errors).toEqual(['apply']);
    expect(run.outcomes).toEqual([{ status: 'failed', detail: audit.importFailed }]);
  });

  it('withholds dangerous permissions when the job names no one', async () => {
    const plan = takeover();
    plan.everyone = ['ViewChannel', 'SendMessages', 'ManageChannels', 'Administrator'];
    const run = harness({ plan, everyone: ['ViewChannel', 'ManageChannels'], holds: () => true });
    const result = await run.apply({ id: null });
    expect(run.checks).toEqual([]);
    expect(run.edits[0]?.edit.permissionBits).toBe(
      permissionBits(['ViewChannel', 'SendMessages', 'ManageChannels']),
    );
    expect(run.roles[0]?.permissions).toEqual(['ManageMessages']);
    expect(result?.withheld).toEqual([
      'Administrator',
      'ManageChannels',
      'BanMembers',
      'ManageWebhooks',
    ]);
  });

  it('records withheld permissions even when nothing else changes', async () => {
    const plan = takeover();
    plan.everyone = ['Administrator'];
    plan.roles = [];
    plan.channels = [];
    const run = harness({ plan, holds: () => false });
    const result = await run.apply();
    expect(run.edits).toEqual([]);
    expect(result).toEqual({
      roles: [],
      channels: [],
      everyone: null,
      failed: [],
      withheld: ['Administrator'],
    });
    expect(run.recorded).toEqual([result]);
    expect(run.outcomes).toEqual([{ status: 'applied', detail: result }]);
  });
});
