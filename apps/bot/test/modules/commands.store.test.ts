import { connect, migrate, type Sql, silentLogger } from '@maxwell/core';
import definition, { type CommandsConfig, commandsConfig } from '@maxwell/core/modules/commands';
import { generalConfig } from '@maxwell/core/modules/general';
import { CommandStore } from '@maxwell/core/stores/commands';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommandRunner } from '../../src/modules/commands/runner.js';
import type { IncomingMessage, Outgoing } from '../../src/platform/types.js';
import type { ModuleContext } from '../../src/runtime/module.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('custom commands with storage', () => {
  let sql: Sql;
  let store: CommandStore;
  let runner: CommandRunner;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const user = '300000000000000001';
  const memberRole = '400000000000000001';
  const brokenRole = '400000000000000002';
  const guestRole = '400000000000000003';
  let config: CommandsConfig = commandsConfig.parse({});
  let enabled = true;
  const replies: Outgoing[] = [];
  const roleCalls: string[] = [];
  const records: unknown[][] = [];

  const ctx = {
    key: 'commands',
    definition,
    services: {
      log: silentLogger,
      guilds: { prefix: async () => 'm!' },
      registry: { primary: (name: string) => ['help'].includes(name.toLowerCase()) },
      settings: { config: async () => generalConfig.parse({}) },
      voice: { cooldown: () => 'Easy.' },
      platform: {
        reply: async (_message: IncomingMessage, out: Outgoing) => {
          replies.push(out);
          return '1';
        },
        send: async (_channel: string, out: Outgoing) => {
          replies.push(out);
          return '1';
        },
        delete: async () => {},
        guild: async () => ({ id: guild, name: 'Magnets', memberCount: 3, iconUrl: null }),
        channels: async () => [
          {
            id: '200000000000000001',
            guildId: guild,
            name: 'general',
            type: 0,
            parentId: null,
            position: 0,
            topic: null,
            nsfw: false,
            userLimit: null,
            rateLimitPerUser: 0,
            overwrites: [],
          },
        ],
        user: async () => null,
        addRole: async (_g: string, _u: string, role: string) => {
          if (role === brokenRole) throw new Error('missing permissions');
          roleCalls.push(`+${role}`);
        },
        removeRole: async (_g: string, _u: string, role: string) => {
          roleCalls.push(`-${role}`);
        },
      },
    },
    config: async () => config,
    enabled: async () => enabled,
    record: async (...args: unknown[]) => {
      records.push(args);
      return '1';
    },
  } as unknown as ModuleContext<typeof commandsConfig>;

  const message = (content: string, roles: string[] = []): IncomingMessage => ({
    id: String(900000000000000000n + BigInt(replies.length)),
    channelId: '200000000000000001',
    guildId: guild,
    content,
    author: { id: user, username: 'lena', displayName: 'Lena', bot: false, avatarUrl: '' },
    memberRoles: roles,
    fromWebhook: false,
    attachments: [],
    mentionUsers: [],
    mentionRoles: [],
    mentionEveryone: false,
    replyTo: null,
    createdAt: new Date(),
    embeds: [],
  });

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, silentLogger, [{ module: 'commands', migrations: definition.migrations }]);
    store = new CommandStore(sql);
    runner = new CommandRunner(ctx, store);
    config = commandsConfig.parse({
      commands: [
        {
          id: 'rules',
          trigger: 'command',
          pattern: 'rules',
          responses: ['Read the rules, {user}. You asked about {args}.'],
          cooldown: 60,
        },
        {
          id: 'verify',
          trigger: 'command',
          pattern: 'verify',
          responses: [],
          addRoles: [memberRole, brokenRole],
          removeRoles: [guestRole],
        },
        { id: 'help', trigger: 'command', pattern: 'help', responses: ['shadowed'] },
        { id: 'gm', trigger: 'keyword', pattern: 'good morning', responses: ['Morning, {user}.'] },
      ],
    });
  });

  afterAll(async () => {
    await sql`delete from commands_usage where guild_id = ${guild}`;
    await sql`delete from commands_tests where guild_id = ${guild}`;
    await sql.end();
  });

  it('answers a command trigger and counts its use', async () => {
    await runner.handle(message('m!rules spam'));
    expect(replies.at(-1)).toMatchObject({
      content: 'Read the rules, Lena. You asked about spam.',
    });
    const usage = await store.usage(guild);
    expect(usage).toMatchObject([{ commandId: 'rules', uses: 1, lastUserId: user }]);
  });

  it('respects the cooldown', async () => {
    const before = replies.length;
    await runner.handle(message('m!rules again'));
    expect(replies.length).toBe(before + 1);
    expect(replies.at(-1)).toMatchObject({ deleteAfter: 8_000 });
  });

  it('never shadows a built-in command', async () => {
    const before = replies.length;
    await runner.handle(message('m!help'));
    expect(replies.length).toBe(before);
  });

  it('answers keywords', async () => {
    await runner.handle(message('well, good morning everyone'));
    expect(replies.at(-1)).toMatchObject({ content: 'Morning, Lena.' });
  });

  it('changes roles, survives failures and records an undo', async () => {
    await runner.handle(message('m!verify', [guestRole]));
    expect(roleCalls).toEqual([`+${memberRole}`, `-${guestRole}`]);
    expect(records.at(-1)?.[2]).toBe('command.roles');
    expect(records.at(-1)?.[4]).toMatchObject({
      undo: { kind: 'roles', payload: { userId: user, added: [memberRole], removed: [guestRole] } },
    });
    await runner.undoRoles(guild, { userId: user, added: [memberRole], removed: [guestRole] });
    expect(roleCalls.slice(2)).toEqual([`-${memberRole}`, `+${guestRole}`]);
  });

  it('stores test renders for the dashboard', async () => {
    const result = await runner.test(guild, {
      commandId: 'rules',
      content: 'm!rules the third',
      channelId: '200000000000000001',
    });
    expect(result).toMatchObject({
      matched: true,
      problem: null,
      content: 'Read the rules, Member. You asked about the third.',
    });
    await store.saveTest(guild, 'req-1', result);
    expect(await store.test(guild, 'req-1')).toEqual(result);

    const draft = await runner.test(guild, {
      command: { id: 'draft', trigger: 'regex', pattern: '(unclosed', responses: ['x'] },
      content: 'anything',
    });
    expect(draft.problem).toBe('invalid_pattern');

    const shadow = await runner.test(guild, { commandId: 'help', content: 'm!help' });
    expect(shadow).toMatchObject({ matched: false, problem: 'builtin' });
    const alias = await runner.test(guild, {
      command: { id: 'alias', trigger: 'command', pattern: 'H', responses: ['x'] },
      content: 'm!h',
    });
    expect(alias).toMatchObject({ matched: true, problem: null });
  });

  it('claims its own command names so the dispatcher stays quiet', async () => {
    expect(await runner.claims(guild, 'rules')).toBe(true);
    expect(await runner.claims(guild, 'RULES')).toBe(true);
    expect(await runner.claims(guild, 'help')).toBe(false);
    expect(await runner.claims(guild, 'gm')).toBe(false);
    expect(await runner.claims(guild, 'nothing')).toBe(false);
    enabled = false;
    expect(await runner.claims(guild, 'rules')).toBe(false);
    enabled = true;
  });

  it('exports and forgets who used a command last, keeping the counts', async () => {
    expect(await store.lastUsedBy(guild, user)).toEqual(
      expect.arrayContaining([expect.objectContaining({ commandId: 'rules' })]),
    );
    expect(await store.lastUsedBy(guild, '300000000000000009')).toEqual([]);
    const before = await store.usage(guild);
    await store.forgetUser(guild, user);
    expect(await store.lastUsedBy(guild, user)).toEqual([]);
    const after = await store.usage(guild);
    expect(after.map((row) => [row.commandId, row.uses, row.lastUserId])).toEqual(
      before.map((row) => [row.commandId, row.uses, null]),
    );
  });
});
