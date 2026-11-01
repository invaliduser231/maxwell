import { connect, migrate, type Sql } from '@maxwell/core';
import definition, { moderationConfig } from '@maxwell/core/modules/moderation';
import { ModerationStore } from '@maxwell/core/stores/moderation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/log.js';
import { ModerationService } from '../../src/modules/moderation/service.js';
import type { Outgoing, UserRef } from '../../src/platform/types.js';
import type { ModuleContext } from '../../src/runtime/module.js';
import type { Services } from '../../src/services.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('ModerationService', () => {
  let sql: Sql;
  let service: ModerationService;
  const guild = String(
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
  );
  const target = '400000000000000003';
  const mod = '400000000000000009';
  const calls: string[] = [];
  const sent: { channel: string; message: Outgoing }[] = [];
  const edits: string[] = [];
  const foreign = new Set<string>();
  const dms: string[] = [];
  const scheduled: { kind: string; key?: string }[] = [];
  const records: { action: string; undo: unknown }[] = [];
  const config = moderationConfig.parse({
    logChannelId: '800',
    escalationSteps: [
      { warns: 2, action: 'timeout', durationMinutes: 10, review: false },
      { warns: 3, action: 'ban', durationMinutes: null, review: true },
    ],
  });

  const user = (id: string): UserRef => ({
    id,
    username: `u${id.slice(-2)}`,
    displayName: `User ${id.slice(-2)}`,
    bot: false,
    avatarUrl: '',
  });

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'moderation', migrations: definition.migrations },
    ]);
    const platform = {
      selfId: '1',
      user: async (id: string) => user(id),
      guild: async () => ({ id: guild, name: 'Lab', memberCount: 10, iconUrl: null }),
      member: async () => null,
      ban: async (_g: string, id: string) => void calls.push(`ban:${id}`),
      unban: async (_g: string, id: string) => void calls.push(`unban:${id}`),
      kick: async (_g: string, id: string) => void calls.push(`kick:${id}`),
      timeout: async (_g: string, id: string, until: Date | null) =>
        void calls.push(`timeout:${id}:${until ? 'set' : 'clear'}`),
      sendDirect: async (_id: string, message: Outgoing) => {
        dms.push(typeof message === 'string' ? message : (message.content ?? ''));
        return true;
      },
      send: async (channel: string, message: Outgoing) => {
        sent.push({ channel, message });
        return String(900 + sent.length);
      },
      edit: async (_channel: string, messageId: string) => void edits.push(messageId),
      channelInGuild: async (_g: string, channel: string) => !foreign.has(channel),
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
      on: () => {},
      job: () => {},
      schedule: async (kind: string, input: { dedupeKey?: string }) => {
        scheduled.push({ kind, key: input.dedupeKey });
        return null;
      },
      undo: () => {},
      onShutdown: () => {},
      record: async (
        _g: string,
        _a: unknown,
        action: string,
        _s: string,
        extra?: { undo?: unknown },
      ) => {
        records.push({ action, undo: extra?.undo ?? null });
        return String(records.length);
      },
    } as unknown as ModuleContext<typeof moderationConfig>;
    service = new ModerationService(ctx, new ModerationStore(sql));
  });

  afterAll(async () => {
    await sql`delete from moderation_cases where guild_id = ${guild}`;
    await sql`delete from moderation_counters where guild_id = ${guild}`;
    await sql.end();
  });

  it('warns, posts to the mod log and tells the member', async () => {
    const result = await service.act({
      guildId: guild,
      action: 'warn',
      userId: target,
      moderatorId: mod,
      reason: 'spam',
      source: 'command',
    });
    expect(result.row.number).toBe(1);
    expect(result.active).toBe(1);
    expect(result.escalation).toBeNull();
    expect(result.dm).toBe('sent');
    expect(dms[0]).toContain('You were warned in **Lab**.');
    expect(sent[0]?.channel).toBe('800');
    expect(records[0]).toEqual({
      action: 'case.warn',
      undo: { kind: 'warn', payload: { number: 1, userId: target } },
    });
    const stored = await service.store.get(guild, 1);
    expect(stored?.logMessageId).toBe('901');
    expect(stored?.meta.auditId).toBe('1');
  });

  it('escalates to a timeout on the second warning', async () => {
    const result = await service.act({
      guildId: guild,
      action: 'warn',
      userId: target,
      moderatorId: mod,
      reason: 'more spam',
      source: 'command',
    });
    expect(result.escalation?.kind).toBe('acted');
    if (result.escalation?.kind !== 'acted') return;
    expect(result.escalation.row.action).toBe('timeout');
    expect(result.escalation.row.moderatorId).toBeNull();
    expect(result.escalation.row.durationSeconds).toBe(600);
    expect(calls).toContain(`timeout:${target}:set`);
    expect(scheduled.some((entry) => entry.key === `moderation.expire:${guild}:3`)).toBe(true);
  });

  it('flags a ban for review on the third warning', async () => {
    const result = await service.act({
      guildId: guild,
      action: 'warn',
      userId: target,
      moderatorId: mod,
      reason: 'again',
      source: 'command',
    });
    expect(result.escalation?.kind).toBe('review');
    expect(calls.some((call) => call.startsWith('ban:'))).toBe(false);
    if (result.escalation?.kind !== 'review') return;
    const flag = result.escalation.row;
    expect(flag.meta.suggested).toBe('ban');

    const approved = await service.resolveReview(guild, flag.number, true, mod);
    expect(approved?.row.action).toBe('ban');
    expect(calls).toContain(`ban:${target}`);
    expect((await service.store.get(guild, flag.number))?.endedAt).not.toBeNull();
  });

  it('records outside actions without touching the platform', async () => {
    const before = calls.length;
    const result = await service.act({
      guildId: guild,
      action: 'unban',
      userId: target,
      moderatorId: null,
      reason: null,
      source: 'external',
    });
    expect(calls.length).toBe(before);
    expect(result.row.meta.external).toBe(true);
    expect(await service.store.openCase(guild, target, 'ban')).toBeNull();
  });

  it('keeps case entries out of a log channel from another community', async () => {
    const before = { sent: sent.length, edits: edits.length };
    foreign.add('800');
    const result = await service.act({
      guildId: guild,
      action: 'unban',
      userId: target,
      moderatorId: null,
      reason: 'elsewhere',
      source: 'external',
    });
    await service.refreshLog(guild, 1);
    foreign.delete('800');
    expect(sent.length).toBe(before.sent);
    expect(edits.length).toBe(before.edits);
    expect((await service.store.get(guild, result.row.number))?.logMessageId).toBeNull();
  });
});
