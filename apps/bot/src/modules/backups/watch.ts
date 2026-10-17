import { type Actor, maxwell } from '@maxwell/core';
import type { SnapshotChannel, SnapshotRole } from '@maxwell/core/modules/backups';
import type { BackupStore } from '@maxwell/core/stores/backups';
import {
  AuditAction,
  type AuditLogEvent,
  type ChannelChange,
  type RoleChange,
} from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { audit } from './copy.js';
import { toSnapshotChannel, toSnapshotRole } from './snapshot.js';
import type { backupsConfig } from './types.js';

const TTL = 5 * 60_000;
const CAP = 5_000;

export class Expected {
  readonly #ids = new Map<string, number>();

  mark(id: string): void {
    const now = Date.now();
    for (const [key, at] of this.#ids) {
      if (now - at <= TTL && this.#ids.size < CAP) break;
      this.#ids.delete(key);
    }
    this.#ids.set(id, now);
  }

  take(id: string): boolean {
    const at = this.#ids.get(id);
    if (at === undefined) return false;
    this.#ids.delete(id);
    return Date.now() - at <= TTL;
  }
}

export const ACTOR_WAIT = 3_000;
const ACTOR_TTL = 15_000;
const ACTOR_CAP = 2_000;

interface Waiter {
  resolve(actorId: string | null): void;
  timer: NodeJS.Timeout;
}

export class AuditActors {
  readonly #seen = new Map<string, { actorId: string | null; at: number }>();
  readonly #waiting = new Map<string, Waiter[]>();

  #key(guildId: string, action: number, targetId: string): string {
    return `${guildId}:${action}:${targetId}`;
  }

  note(entry: AuditLogEvent, now = Date.now()): void {
    if (!entry.targetId) return;
    const key = this.#key(entry.guildId, entry.action, entry.targetId);
    const waiters = this.#waiting.get(key);
    if (waiters && waiters.length > 0) {
      this.#waiting.delete(key);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(entry.actorId);
      }
      return;
    }
    for (const [old, seen] of this.#seen) {
      if (now - seen.at <= ACTOR_TTL && this.#seen.size < ACTOR_CAP) break;
      this.#seen.delete(old);
    }
    this.#seen.set(key, { actorId: entry.actorId, at: now });
  }

  wait(guildId: string, action: number, targetId: string, ms = ACTOR_WAIT): Promise<string | null> {
    const key = this.#key(guildId, action, targetId);
    const seen = this.#seen.get(key);
    if (seen) {
      this.#seen.delete(key);
      if (Date.now() - seen.at <= ACTOR_TTL) return Promise.resolve(seen.actorId);
    }
    return new Promise((resolve) => {
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => {
          const list = this.#waiting.get(key)?.filter((item) => item !== waiter) ?? [];
          if (list.length > 0) this.#waiting.set(key, list);
          else this.#waiting.delete(key);
          resolve(null);
        }, ms),
      };
      waiter.timer.unref?.();
      this.#waiting.set(key, [...(this.#waiting.get(key) ?? []), waiter]);
    });
  }
}

export function actorFor(actorId: string | null, selfId: string | null): Actor {
  if (!actorId || actorId === selfId) return maxwell;
  return { id: actorId };
}

export function mergeRole(
  saved: SnapshotRole | null,
  live: SnapshotRole | null,
): SnapshotRole | null {
  if (!saved) return live;
  if (!live) return saved;
  return {
    ...saved,
    name: live.name || saved.name,
    color: live.color,
    permissions: live.permissions,
    hoist: live.hoist ?? saved.hoist,
    mentionable: live.mentionable ?? saved.mentionable,
  };
}

export function mergeChannel(
  saved: SnapshotChannel | null,
  live: SnapshotChannel | null,
): SnapshotChannel | null {
  if (!saved) return live;
  if (!live) return saved;
  return {
    ...saved,
    name: live.name || saved.name,
    type: live.type,
    parentId: live.parentId,
    topic: live.topic ?? saved.topic,
    userLimit: live.userLimit ?? saved.userLimit,
    nsfw: live.nsfw ?? saved.nsfw,
    rateLimitPerUser: live.rateLimitPerUser ?? saved.rateLimitPerUser ?? null,
    overwrites: live.overwrites ?? saved.overwrites,
  };
}

export class DeletionWatch {
  constructor(
    private readonly ctx: ModuleContext<typeof backupsConfig>,
    private readonly store: BackupStore,
    private readonly expected: Expected,
    private readonly actors: AuditActors = new AuditActors(),
    private readonly actorWait = ACTOR_WAIT,
  ) {}

  onAuditLog(entry: AuditLogEvent): void {
    if (entry.action !== AuditAction.RoleDelete && entry.action !== AuditAction.ChannelDelete) {
      return;
    }
    this.actors.note(entry);
  }

  async #actor(guildId: string, action: number, targetId: string): Promise<Actor> {
    const actorId = await this.actors.wait(guildId, action, targetId, this.actorWait);
    return actorFor(actorId, this.ctx.services.platform.selfId);
  }

  async onRoleDelete(change: RoleChange): Promise<void> {
    if (this.expected.take(change.roleId)) return;
    const config = await this.ctx.config(change.guildId);
    if (!config.undoDeletions) return;
    const saved = await this.store.findRole(change.guildId, change.roleId);
    const live = change.before ?? change.role;
    const role = mergeRole(saved?.role ?? null, live ? toSnapshotRole(live) : null);
    if (!role || role.id === change.guildId) return;
    const by = await this.#actor(change.guildId, AuditAction.RoleDelete, change.roleId);
    await this.ctx.record(change.guildId, by, 'role.deleted', audit.auditRoleDeleted(role.name), {
      before: role,
      undo: { kind: 'recreate.role', payload: { role, snapshotId: saved?.snapshotId ?? null } },
    });
  }

  async onChannelDelete(change: ChannelChange): Promise<void> {
    if (this.expected.take(change.channel.id)) return;
    const config = await this.ctx.config(change.guildId);
    if (!config.undoDeletions) return;
    const saved = await this.store.findChannel(change.guildId, change.channel.id);
    const channel = mergeChannel(saved?.channel ?? null, toSnapshotChannel(change.channel));
    if (!channel) return;
    const by = await this.#actor(change.guildId, AuditAction.ChannelDelete, change.channel.id);
    await this.ctx.record(
      change.guildId,
      by,
      'channel.deleted',
      audit.auditChannelDeleted(channel.name),
      {
        before: channel,
        undo: {
          kind: 'recreate.channel',
          payload: { channel, snapshotId: saved?.snapshotId ?? null },
        },
      },
    );
  }
}
