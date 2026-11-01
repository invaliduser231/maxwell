import { EventEmitter } from 'node:events';
import { connect, migrate, type Sql } from '@maxwell/core';
import definition from '@maxwell/core/modules/roles';
import { RolesStore } from '@maxwell/core/stores/roles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { createLogger } from '../../src/log.js';
import logs from '../../src/modules/logs/index.js';
import roles from '../../src/modules/roles/index.js';
import type { OutgoingMessage, ReactionEvent } from '../../src/platform/types.js';
import { createContext } from '../../src/runtime/module.js';
import { PrivacyRegistry } from '../../src/runtime/privacy.js';
import type { Services } from '../../src/services.js';

const url = process.env.TEST_DATABASE_URL;

function snowflake(base: bigint): string {
  return String(base + BigInt(Math.floor(Math.random() * 1_000_000_000)));
}

describe.skipIf(!url)('role menu flow', () => {
  let sql: Sql;
  const guildId = snowflake(917_000_000_000_000n);
  const channelId = snowflake(517_000_000_000_000n);
  const messageId = snowflake(717_000_000_000_000n);
  const logChannel = '518000000000000001';
  const roleId = '118000000000000001';
  const user = {
    id: '318000000000000001',
    username: 'lena',
    displayName: 'Lena',
    bot: false,
    avatarUrl: '',
  };
  const events = new EventEmitter();
  const calls: string[] = [];
  const sent: { channelId: string; message: OutgoingMessage }[] = [];
  let memberRoles: string[] = [];

  let stored: string[] = [];
  const changeRoles = (next: string[]) => {
    stored = next;
    setTimeout(() => {
      const before = memberRoles;
      memberRoles = next;
      events.emit('memberUpdate', {
        guildId,
        user,
        nick: null,
        roles: [...next],
        timeoutUntil: null,
        before: { nick: null, roles: [...before], timeoutUntil: null },
      });
    }, 20);
  };

  const platform = {
    selfId: '318000000000000099',
    on: (event: string, listener: (...args: unknown[]) => void) => events.on(event, listener),
    member: async () => ({
      guildId,
      user,
      nick: null,
      roles: [...memberRoles],
      joinedAt: new Date(0),
      timeoutUntil: null,
    }),
    addRole: async (_g: string, _u: string, id: string) => {
      calls.push(`add ${id}`);
      changeRoles(stored.includes(id) ? stored : [...stored, id]);
    },
    removeRole: async (_g: string, _u: string, id: string) => {
      calls.push(`remove ${id}`);
      changeRoles(stored.filter((entry) => entry !== id));
    },
    unreact: async () => {},
    send: async (target: string, message: OutgoingMessage) => {
      sent.push({ channelId: target, message });
      return snowflake(719_000_000_000_000n);
    },
    channels: async () => [],
    channelInGuild: async () => true,
    missingBotPermissions: async () => [],
  };

  const configs: Record<string, unknown> = {
    roles: {
      menus: [
        {
          id: 'colors',
          channelId,
          type: 'normal',
          entries: [{ emoji: '\u{1F436}', roleId }],
        },
      ],
    },
    logs: { defaultChannelId: logChannel },
  };

  const reaction: ReactionEvent = {
    guildId,
    channelId,
    messageId,
    userId: user.id,
    emoji: '\u{1F436}',
    bot: false,
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'roles', migrations: definition.migrations },
    ]);
    await new RolesStore(sql).saveMenuMessage(guildId, 'colors', channelId, messageId, [
      '\u{1F436}',
    ]);
    const services = {
      sql,
      privacy: new PrivacyRegistry(),
      log: createLogger('silent', false),
      platform,
      voice: { icon: () => null },
      jobs: { handle: () => {}, enqueue: async () => null },
      undo: { handle: () => {} },
      settings: {
        config: async (_g: string, key: string, schema: z.ZodType) =>
          schema.parse(configs[key] ?? {}),
        enabled: async () => true,
      },
      audit: { record: async () => '1' },
    } as unknown as Services;
    await logs.setup?.(createContext(logs.definition, services));
    await roles.setup?.(createContext(roles.definition, services));
  });

  beforeEach(() => {
    calls.length = 0;
    sent.length = 0;
  });

  afterAll(async () => {
    await sql`delete from roles_menu_messages where guild_id = ${guildId}`;
    await sql.end();
  });

  const roleLogs = () =>
    sent.filter((entry) => entry.channelId === logChannel && entry.message.embeds?.length);

  it('gives the role once and logs it once when a reaction is delivered twice', async () => {
    events.emit('reaction', reaction);
    events.emit('reaction', reaction);
    await settle();
    expect(calls).toEqual([`add ${roleId}`]);
    expect(roleLogs()).toHaveLength(1);
  });

  it('still follows a real remove and a new click', async () => {
    events.emit('reactionRemove', reaction);
    await settle();
    events.emit('reaction', reaction);
    await settle();
    expect(calls).toEqual([`remove ${roleId}`, `add ${roleId}`]);
    expect(roleLogs()).toHaveLength(2);
  });
});
