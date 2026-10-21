import { connect, migrate, type Sql } from '@maxwell/core';
import definition, { moderationConfig } from '@maxwell/core/modules/moderation';
import { ModerationStore } from '@maxwell/core/stores/moderation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';
import { ChannelTools } from '../../src/modules/moderation/channels.js';
import { Confirmations } from '../../src/modules/moderation/confirm.js';
import { registerEvents } from '../../src/modules/moderation/events.js';
import { NameTracker } from '../../src/modules/moderation/names.js';
import { exportMember } from '../../src/modules/moderation/privacy.js';
import { ModerationService } from '../../src/modules/moderation/service.js';
import { permissionBits } from '../../src/platform/permissions.js';
import {
  AuditAction,
  type AuditLogEvent,
  type ChannelRef,
  type Overwrite,
  type UserRef,
} from '../../src/platform/types.js';
import type { ModuleContext } from '../../src/runtime/module.js';
import type { Services } from '../../src/services.js';

const url = process.env.TEST_DATABASE_URL;

const SEND = String(1n << 11n);
const VIEW = String(1n << 10n);
const UNKNOWN = 1n << 50n;

describe.skipIf(!url)('moderation flows', () => {
  let sql: Sql;
  let moderation: ModerationService;
  let tools: ChannelTools;
  const handlers = new Map<string, (payload: unknown) => Promise<void> | void>();
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const self = '100000000000000001';
  const mod = '400000000000000009';
  const edits: string[] = [];
  const removed: string[] = [];
  const confirmations = new Confirmations();
  const config = moderationConfig.parse({ logChannelId: '800', modRoleIds: ['700'] });

  const channel: ChannelRef = {
    id: '600',
    guildId: guild,
    name: 'general',
    type: 0,
    parentId: null,
    position: 0,
    topic: null,
    nsfw: false,
    userLimit: null,
    rateLimitPerUser: 15,
    overwrites: [{ id: guild, type: 'role', allow: '0', deny: String(UNKNOWN) }],
  };

  const user = (id: string): UserRef => ({
    id,
    username: `u${id.slice(-2)}`,
    displayName: `User ${id.slice(-2)}`,
    bot: false,
    avatarUrl: '',
  });

  const emit = async (event: string, payload: unknown) => {
    await handlers.get(event)?.(payload);
  };

  const audit = (
    action: number,
    targetId: string,
    actorId = mod,
    reason = 'raid',
  ): AuditLogEvent => ({
    id: `${action}:${targetId}:${reason}`,
    guildId: guild,
    action,
    actorId,
    targetId,
    reason,
    changes: [],
  });

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'moderation', migrations: definition.migrations },
    ]);
    let sent = 0;
    const platform = {
      selfId: self,
      user: async (id: string) => user(id),
      guild: async () => ({ id: guild, name: 'Lab', memberCount: 10, iconUrl: null }),
      member: async () => null,
      send: async () => String(9_000 + ++sent),
      sendDirect: async () => true,
      edit: async (_channel: string, messageId: string) => void edits.push(messageId),
      channels: async () => [channel],
      missingBotPermissions: async () => ['Administrator'],
      setOverwrite: async (_channel: string, overwrite: Overwrite) => {
        const existing = channel.overwrites.find((entry) => entry.id === overwrite.id);
        const keep = (bits: string | undefined) => BigInt(bits ?? '0') & UNKNOWN;
        const next = {
          id: overwrite.id,
          type: overwrite.type,
          allow: String(BigInt(permissionBits(overwrite.allow)) | keep(existing?.allow)),
          deny: String(BigInt(permissionBits(overwrite.deny)) | keep(existing?.deny)),
        };
        channel.overwrites = [
          ...channel.overwrites.filter((entry) => entry.id !== overwrite.id),
          next,
        ];
      },
      deleteOverwrite: async (_channel: string, id: string) => {
        removed.push(id);
        channel.overwrites = channel.overwrites.filter((entry) => entry.id !== id);
      },
      editChannel: async (_channel: string, input: { rateLimitPerUser?: number }) => {
        if (input.rateLimitPerUser !== undefined) channel.rateLimitPerUser = input.rateLimitPerUser;
      },
    };
    const services = {
      sql,
      platform,
      log: createLogger('silent', false),
      guilds: { prefix: async () => '!' },
    } as unknown as Services;
    const ctx = {
      key: 'moderation',
      definition,
      services,
      config: async () => config,
      enabled: async () => true,
      update: async () => {},
      on: (event: string, handler: (payload: unknown) => Promise<void> | void) => {
        handlers.set(event, handler);
      },
      job: () => {},
      schedule: async () => null,
      undo: () => {},
      privacy: () => {},
      onShutdown: () => {},
      record: async () => '1',
    } as unknown as ModuleContext<typeof moderationConfig>;
    const store = new ModerationStore(sql);
    moderation = new ModerationService(ctx, store);
    tools = new ChannelTools(moderation);
    registerEvents(moderation, new NameTracker(store), confirmations);
  });

  afterAll(async () => {
    confirmations.stop();
    await sql`delete from moderation_cases where guild_id = ${guild}`;
    await sql`delete from moderation_counters where guild_id = ${guild}`;
    await sql`delete from moderation_notes where guild_id = ${guild}`;
    await sql`delete from moderation_names where guild_id = ${guild}`;
    await sql`delete from moderation_locks where guild_id = ${guild}`;
    await sql.end();
  });

  it('attaches the moderator to a ban case created moments before', async () => {
    const target = '400000000000000011';
    await emit('banAdd', { guildId: guild, user: user(target) });
    const before = await moderation.store.list(guild, { userId: target });
    expect(before[0]?.moderatorId).toBeNull();

    await emit('auditLog', audit(AuditAction.MemberBanAdd, target));
    const row = await moderation.store.get(guild, before[0]?.number ?? 0);
    expect(row?.moderatorId).toBe(mod);
    expect(row?.reason).toBe('raid');
    expect(edits).toContain(row?.logMessageId);
  });

  it('uses an audit entry that arrives before the ban event', async () => {
    const target = '400000000000000012';
    await emit('auditLog', audit(AuditAction.MemberBanRemove, target, mod, 'appeal'));
    await emit('banRemove', { guildId: guild, user: user(target) });
    const [row] = await moderation.store.list(guild, { userId: target });
    expect(row?.action).toBe('unban');
    expect(row?.moderatorId).toBe(mod);
    expect(row?.reason).toBe('appeal');
    expect(row?.meta.external).toBe(true);
  });

  it('attributes timeouts from member updates', async () => {
    const target = '400000000000000013';
    const until = new Date(Date.now() + 600_000);
    await emit('memberUpdate', {
      guildId: guild,
      user: user(target),
      nick: null,
      roles: [],
      timeoutUntil: until,
      before: { nick: null, roles: [], timeoutUntil: null },
    });
    await emit('auditLog', {
      ...audit(AuditAction.MemberUpdate, target, mod, 'cool off'),
      changes: [{ key: 'communication_disabled_until', before: null, after: until.toISOString() }],
    });
    const [row] = await moderation.store.list(guild, { userId: target });
    expect(row?.action).toBe('timeout');
    expect(row?.moderatorId).toBe(mod);
    expect(row?.reason).toBe('cool off');
  });

  it('records kicks done outside Maxwell and skips its own', async () => {
    const target = '400000000000000014';
    await emit('auditLog', audit(AuditAction.MemberKick, target, mod, 'ads'));
    await emit('auditLog', audit(AuditAction.MemberKick, target, self, 'mine'));
    const rows = await moderation.store.list(guild, { userId: target });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('kick');
    expect(rows[0]?.moderatorId).toBe(mod);
    expect(rows[0]?.reason).toBe('ads');
  });

  it('ignores audit entries for actions Maxwell did itself', async () => {
    const target = '400000000000000015';
    moderation.expected.expect(guild, target, 'ban');
    await emit('auditLog', audit(AuditAction.MemberBanAdd, target, self));
    await emit('banAdd', { guildId: guild, user: user(target) });
    expect(await moderation.store.list(guild, { userId: target })).toEqual([]);
    expect(moderation.holds.take(guild, target, 'ban')).toBeNull();
  });

  it('locks and unlocks from raw overwrites without leaving extras behind', async () => {
    const locked = await tools.lock({
      guildId: guild,
      channelId: channel.id,
      moderatorId: mod,
      reason: null,
      durationMs: null,
    });
    expect(locked.status).toBe('locked');
    const everyone = channel.overwrites.find((entry) => entry.id === guild);
    expect(BigInt(everyone?.deny ?? '0')).toBe(UNKNOWN | (1n << 11n));
    expect(channel.overwrites.find((entry) => entry.id === '700')?.allow).toBe(SEND);
    expect(channel.overwrites.find((entry) => entry.id === self)?.allow).toBe(SEND);

    const again = await tools.lock({
      guildId: guild,
      channelId: channel.id,
      moderatorId: mod,
      reason: null,
      durationMs: null,
    });
    expect(again.status).toBe('already');

    channel.overwrites = channel.overwrites.map((entry) =>
      entry.id === '700' ? { ...entry, deny: VIEW } : entry,
    );
    const unlocked = await tools.unlock({
      guildId: guild,
      channelId: channel.id,
      moderatorId: mod,
      reason: null,
      record: true,
    });
    expect(unlocked.status).toBe('unlocked');
    expect(channel.overwrites.find((entry) => entry.id === guild)?.deny).toBe(String(UNKNOWN));
    expect(removed).toEqual([self]);
    expect(channel.overwrites.find((entry) => entry.id === '700')).toEqual({
      id: '700',
      type: 'role',
      allow: '0',
      deny: VIEW,
    });
  });

  it('unlocks channels locked by hand', async () => {
    channel.overwrites = [{ id: guild, type: 'role', allow: '0', deny: SEND }];
    const result = await tools.unlock({
      guildId: guild,
      channelId: channel.id,
      moderatorId: mod,
      reason: null,
      record: false,
    });
    expect(result.status).toBe('unlocked');
    expect(channel.overwrites[0]?.deny).toBe('0');
  });

  it('reads the previous slowmode from the channel', async () => {
    channel.rateLimitPerUser = 15;
    const result = await tools.slowmode({
      guildId: guild,
      channelId: channel.id,
      seconds: 60,
      moderatorId: mod,
    });
    expect(result).toEqual({ status: 'set', previous: 15 });
    expect(channel.rateLimitPerUser).toBe(60);
  });

  it('exports cases and forgets notes and names', async () => {
    const target = '400000000000000016';
    await moderation.act({
      guildId: guild,
      action: 'warn',
      userId: target,
      moderatorId: mod,
      reason: 'spam',
      excerpt: 'buy now',
      source: 'command',
      escalate: false,
    });
    await moderation.store.addNote(guild, target, mod, 'watch this one');
    await moderation.store.recordName(guild, target, 'nick', 'Spammy', null, false);

    const data = await exportMember(moderation.store, guild, target);
    expect(data?.cases).toEqual([
      expect.objectContaining({ action: 'warn', reason: 'spam', excerpt: 'buy now' }),
    ]);
    expect(data?.nameHistory).toEqual([expect.objectContaining({ kind: 'nick', value: 'Spammy' })]);
    expect(data?.notesAboutYou).toBe(1);
    expect(JSON.stringify(data)).not.toContain(mod);
    expect((await exportMember(moderation.store, guild, mod))?.casesYouIssued).toBeGreaterThan(0);

    await moderation.store.forgetMember(guild, target);
    const after = await exportMember(moderation.store, guild, target);
    expect(after?.nameHistory).toEqual([]);
    expect(after?.notesAboutYou).toBe(0);
    expect(after?.cases).toHaveLength(1);
    expect(await exportMember(moderation.store, guild, '400000000000000099')).toBeNull();
  });
});
