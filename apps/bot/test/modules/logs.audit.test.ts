import { logsConfig } from '@maxwell/core/modules/logs';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';
import { AuditTrail } from '../../src/modules/logs/audit.js';
import { MessageCache } from '../../src/modules/logs/cache.js';
import { routeFor } from '../../src/modules/logs/config.js';
import { banEmbed, kickEmbed, withActor } from '../../src/modules/logs/embeds.js';
import logs from '../../src/modules/logs/index.js';
import {
  AuditAction,
  type AuditLogEvent,
  type IncomingMessage,
  type OutgoingMessage,
  type UserRef,
} from '../../src/platform/types.js';
import type { BotModule, ModuleContext } from '../../src/runtime/module.js';
import type { PrivacyHandler } from '../../src/runtime/privacy.js';
import type { Services } from '../../src/services.js';

const lena: UserRef = {
  id: '400000000000000001',
  username: 'lena',
  displayName: 'Lena',
  bot: false,
  avatarUrl: '',
};

function entry(action: number, targetId: string, overrides: Partial<AuditLogEvent> = {}) {
  return {
    id: `${action}:${targetId}`,
    guildId: '900',
    action,
    actorId: '400000000000000009',
    targetId,
    reason: 'cleanup',
    changes: [],
    ...overrides,
  } satisfies AuditLogEvent;
}

describe('kick route', () => {
  it('parses configs saved before kicks existed', () => {
    const config = logsConfig.parse({
      defaultChannelId: '1',
      routes: { bans: { channelId: '2' } },
    });
    expect(config.routes.kicks).toEqual({ enabled: true, channelId: null });
    expect(routeFor(config, 'kicks')).toBe('1');
  });
});

describe('audit trail', () => {
  it('hands out a stored entry once and drops stale ones', () => {
    const trail = new AuditTrail(1_000);
    trail.add(entry(AuditAction.RoleDelete, '5'), 0);
    expect(trail.take('900', AuditAction.RoleCreate, '5', 10)).toBeNull();
    expect(trail.take('900', AuditAction.RoleDelete, '5', 10)?.reason).toBe('cleanup');
    expect(trail.take('900', AuditAction.RoleDelete, '5', 10)).toBeNull();
    trail.add(entry(AuditAction.RoleDelete, '5'), 0);
    expect(trail.take('900', AuditAction.RoleDelete, '5', 5_000)).toBeNull();
  });

  it('stays bounded', () => {
    const trail = new AuditTrail(1_000, 2);
    for (const id of ['1', '2', '3']) trail.add(entry(AuditAction.ChannelDelete, id));
    expect(trail.size).toBe(2);
    expect(trail.take('900', AuditAction.ChannelDelete, '1')).toBeNull();
  });

  it('wakes a waiter when the entry arrives late', async () => {
    const trail = new AuditTrail();
    const waiting = trail.wait('900', AuditAction.MemberBanAdd, lena.id, 5_000);
    trail.add(entry(AuditAction.MemberBanAdd, lena.id));
    expect((await waiting)?.actorId).toBe('400000000000000009');
    expect(trail.size).toBe(0);
  });

  it('gives up after the timeout', async () => {
    const trail = new AuditTrail();
    expect(await trail.wait('900', AuditAction.MemberBanAdd, lena.id, 5)).toBeNull();
    const pending = trail.wait('900', AuditAction.MemberBanAdd, lena.id, 5_000);
    trail.stop();
    expect(await pending).toBeNull();
  });
});

describe('actor lines', () => {
  it('adds who did it and why', () => {
    const embed = withActor(banEmbed('ban', lena), entry(AuditAction.MemberBanAdd, lena.id));
    expect(embed.description).toBe(
      `<@${lena.id}>\n**By** <@400000000000000009>\n**Reason** cleanup`,
    );
    expect(withActor(banEmbed('ban', lena), null).description).toBe(`<@${lena.id}>`);
    expect(withActor(banEmbed('ban', lena), { actorId: null, reason: '  ' }).description).toBe(
      `<@${lena.id}>`,
    );
  });

  it('builds a kick entry', () => {
    const embed = kickEmbed(lena.id, lena, entry(AuditAction.MemberKick, lena.id));
    expect(embed.title).toBe('Member kicked');
    expect(embed.author?.name).toBe('Lena (@lena)');
    expect(embed.description).toContain('**Reason** cleanup');
    expect(embed.footer).toBe(`User ${lena.id}`);
  });
});

describe('message cache privacy', () => {
  it('forgets one author in one guild', () => {
    const cache = new MessageCache();
    const base: IncomingMessage = {
      id: '1',
      channelId: '700',
      guildId: '900',
      content: 'hi',
      author: lena,
      memberRoles: [],
      fromWebhook: false,
      attachments: [],
      embeds: [],
      mentionUsers: [],
      mentionRoles: [],
      mentionEveryone: false,
      replyTo: null,
      createdAt: new Date(),
    };
    cache.add(base);
    cache.add({ ...base, id: '2', guildId: '901' });
    cache.add({ ...base, id: '3', author: { ...lena, id: '5' } });
    expect(cache.forgetAuthor('900', lena.id)).toBe(1);
    expect(cache.get('1')).toBeNull();
    expect(cache.get('2')).not.toBeNull();
    expect(cache.get('3')).not.toBeNull();
  });
});

describe('logs module with audit entries', () => {
  function setup(missing: string[] = [], channelId = '50') {
    const handlers = new Map<string, (payload: unknown) => Promise<void> | void>();
    const sent: OutgoingMessage[] = [];
    const privacy: PrivacyHandler[] = [];
    const platform = {
      selfId: '1',
      user: async (id: string) => ({ ...lena, id }),
      send: async (_channel: string, message: OutgoingMessage) => {
        sent.push(message);
        return String(sent.length);
      },
      channels: async () => [],
      channelInGuild: async (guildId: string, id: string) => guildId === '900' && id === '50',
      missingBotPermissions: async () => missing,
    };
    const ctx = {
      key: 'logs',
      definition: logs.definition,
      services: { platform, log: createLogger('silent', false) } as unknown as Services,
      config: async () => logsConfig.parse({ defaultChannelId: channelId }),
      enabled: async () => true,
      update: async () => {},
      on: (event: string, handler: (payload: unknown) => Promise<void> | void) => {
        handlers.set(event, handler);
      },
      job: () => {},
      schedule: async () => null,
      undo: () => {},
      privacy: (handler: PrivacyHandler) => void privacy.push(handler),
      onShutdown: () => {},
      record: async () => '1',
    } as unknown as ModuleContext;
    (logs as BotModule).setup?.(ctx as never);
    const emit = (event: string, payload: unknown) => handlers.get(event)?.(payload);
    return { emit, sent, privacy };
  }

  it('adds the moderator to a role deletion that arrives first', async () => {
    const { emit, sent } = setup();
    const role = {
      id: '77',
      name: 'Old',
      color: 0,
      position: 1,
      permissions: '0',
      managed: false,
      hoist: false,
      mentionable: false,
    };
    const pending = emit('roleDelete', { guildId: '900', role: null, roleId: '77', before: role });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await emit('auditLog', entry(AuditAction.RoleDelete, '77'));
    await pending;
    expect(sent[0]?.embeds?.[0]?.description).toContain('**By** <@400000000000000009>');
  });

  it('adds the moderator to a ban whose entry came before the event', async () => {
    const { emit, sent } = setup();
    await emit('auditLog', entry(AuditAction.MemberBanAdd, lena.id, { reason: 'raid' }));
    await emit('banAdd', { guildId: '900', user: lena });
    expect(sent[0]?.embeds?.[0]?.description).toContain('**Reason** raid');
  });

  it('logs kicks as their own entry', async () => {
    const { emit, sent } = setup();
    await emit('auditLog', entry(AuditAction.MemberKick, lena.id));
    expect(sent[0]?.embeds?.[0]?.title).toBe('Member kicked');
  });

  it('posts nothing into a log channel from another community', async () => {
    const { emit, sent } = setup([], '51');
    await emit('auditLog', entry(AuditAction.MemberKick, lena.id));
    expect(sent).toEqual([]);
  });

  it('does not wait without audit log access', async () => {
    const { emit, sent } = setup(['ViewAuditLog']);
    const started = Date.now();
    await emit('channelDelete', {
      guildId: '900',
      channel: {
        id: '5',
        guildId: '900',
        name: 'old',
        type: 0,
        parentId: null,
        position: 0,
        topic: null,
        nsfw: false,
        userLimit: null,
        rateLimitPerUser: 0,
        overwrites: [],
      },
      before: null,
    });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(sent[0]?.embeds?.[0]?.description).not.toContain('**By**');
  });

  it('registers a forget handler for the message cache', () => {
    const { privacy } = setup();
    expect(privacy).toHaveLength(1);
    expect(privacy[0]?.forget).toBeTypeOf('function');
  });
});
