import type { Actor } from '@maxwell/core';
import type { BackupStore } from '@maxwell/core/stores/backups';
import { describe, expect, it } from 'vitest';
import { AuditActors, actorFor, DeletionWatch, Expected } from '../../src/modules/backups/watch.js';
import { AuditAction, type AuditLogEvent, type ChannelRef } from '../../src/platform/types.js';
import type { ModuleContext } from '../../src/runtime/module.js';

const GUILD = '900000000000000001';
const SELF = '800000000000000001';
const MOD = '300000000000000001';

function entry(action: number, targetId: string, actorId: string | null = MOD): AuditLogEvent {
  return {
    id: `${action}:${targetId}`,
    guildId: GUILD,
    action,
    actorId,
    targetId,
    reason: null,
    changes: [],
  };
}

function channel(id: string): ChannelRef {
  return {
    id,
    guildId: GUILD,
    name: 'general',
    type: 0,
    parentId: null,
    position: 0,
    topic: 'hello',
    nsfw: false,
    userLimit: null,
    rateLimitPerUser: 5,
    overwrites: [{ id: GUILD, type: 'role', allow: '1024', deny: '0' }],
  };
}

function setup(wait = 50) {
  const records: { actor: Actor; action: string; before: unknown }[] = [];
  const ctx = {
    services: { platform: { selfId: SELF } },
    config: async () => ({ undoDeletions: true }),
    record: async (
      _guild: string,
      actor: Actor,
      action: string,
      _summary: string,
      extra: { before?: unknown },
    ) => {
      records.push({ actor, action, before: extra.before });
      return '1';
    },
  } as unknown as ModuleContext<never>;
  const store = {
    findRole: async () => null,
    findChannel: async () => null,
  } as unknown as BackupStore;
  const actors = new AuditActors();
  const watch = new DeletionWatch(ctx as never, store, new Expected(), actors, wait);
  return { watch, records, actors };
}

describe('AuditActors', () => {
  it('hands an earlier audit entry to a later deletion', async () => {
    const actors = new AuditActors();
    actors.note(entry(AuditAction.RoleDelete, '5'));
    expect(await actors.wait(GUILD, AuditAction.RoleDelete, '5', 10)).toBe(MOD);
    expect(await actors.wait(GUILD, AuditAction.RoleDelete, '5', 10)).toBeNull();
  });

  it('waits for an audit entry that arrives after the deletion', async () => {
    const actors = new AuditActors();
    const pending = actors.wait(GUILD, AuditAction.ChannelDelete, '7', 1_000);
    actors.note(entry(AuditAction.ChannelDelete, '7'));
    expect(await pending).toBe(MOD);
  });

  it('gives up after the window and ignores other targets', async () => {
    const actors = new AuditActors();
    actors.note(entry(AuditAction.RoleDelete, '8'));
    actors.note(entry(AuditAction.ChannelDelete, '9'));
    expect(await actors.wait(GUILD, AuditAction.RoleDelete, '9', 10)).toBeNull();
  });

  it('treats its own deletions as Maxwell', () => {
    expect(actorFor(SELF, SELF)).toEqual({ id: null });
    expect(actorFor(null, SELF)).toEqual({ id: null });
    expect(actorFor(MOD, SELF)).toEqual({ id: MOD });
  });
});

describe('DeletionWatch', () => {
  it('records who deleted a channel', async () => {
    const { watch, records } = setup(1_000);
    const pending = watch.onChannelDelete({ guildId: GUILD, channel: channel('42'), before: null });
    watch.onAuditLog(entry(AuditAction.ChannelDelete, '42'));
    await pending;
    expect(records).toHaveLength(1);
    expect(records[0]?.actor).toEqual({ id: MOD });
    expect(records[0]?.before).toMatchObject({
      topic: 'hello',
      rateLimitPerUser: 5,
      overwrites: [{ id: GUILD, type: 'role', allow: '1024', deny: '0' }],
    });
  });

  it('records a role deletion with the actor seen first', async () => {
    const { watch, records } = setup();
    watch.onAuditLog(entry(AuditAction.RoleDelete, '43'));
    watch.onAuditLog(entry(AuditAction.MemberKick, '43', '1'));
    await watch.onRoleDelete({
      guildId: GUILD,
      roleId: '43',
      role: null,
      before: {
        id: '43',
        name: 'Crew',
        color: 0,
        position: 2,
        permissions: '0',
        managed: false,
        hoist: true,
        mentionable: false,
      },
    });
    expect(records[0]).toMatchObject({ action: 'role.deleted', actor: { id: MOD } });
  });

  it('falls back to Maxwell when no audit entry shows up', async () => {
    const { watch, records } = setup(10);
    await watch.onChannelDelete({ guildId: GUILD, channel: channel('44'), before: null });
    expect(records[0]?.actor).toEqual({ id: null });
  });
});
