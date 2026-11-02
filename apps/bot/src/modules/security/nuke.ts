import { maxwell } from '@maxwell/core';
import type { NukeLimitKey, NukeSettings } from '@maxwell/core/modules/security';
import type { BackupStore } from '@maxwell/core/stores/backups';
import type { SecurityStore } from '@maxwell/core/stores/security';
import { permissionNames } from '../../platform/permissions.js';
import type { AuditLogEvent, Permission, RoleRef } from '../../platform/types.js';
import { lines } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { copy, reasons } from './copy.js';
import type { Ctx, Guard } from './guard.js';
import type { NukeReport } from './incidents.js';

export const dangerous: readonly Permission[] = [
  'Administrator',
  'ManageGuild',
  'ManageChannels',
  'ManageRoles',
  'BanMembers',
  'KickMembers',
  'ManageWebhooks',
];

export const Audit = {
  ChannelCreate: 10,
  ChannelDelete: 12,
  MemberKick: 20,
  MemberPrune: 21,
  MemberBanAdd: 22,
  MemberRoleUpdate: 25,
  BotAdd: 28,
  RoleUpdate: 31,
  RoleDelete: 32,
  WebhookCreate: 50,
} as const;

const SIMPLE: Record<number, NukeLimitKey> = {
  [Audit.ChannelCreate]: 'channelCreate',
  [Audit.ChannelDelete]: 'channelDelete',
  [Audit.MemberKick]: 'kick',
  [Audit.MemberPrune]: 'kick',
  [Audit.MemberBanAdd]: 'ban',
  [Audit.BotAdd]: 'botAdd',
  [Audit.RoleDelete]: 'roleDelete',
  [Audit.WebhookCreate]: 'webhook',
};

const ACTOR_CAP = 20_000;
const RESTORE_QUIET = 5_000;
const RESTORE_MAX = 30_000;
const RESTORE_MEMORY = 10 * 60_000;
const RESTRIKE_GAP = 5_000;

interface PendingRestore {
  channels: Set<string>;
  roles: Set<string>;
  first: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export function hasDangerous(bits: unknown): boolean {
  if (typeof bits !== 'string' && typeof bits !== 'number') return false;
  const names = permissionNames(String(bits));
  return names.some((name) => dangerous.includes(name));
}

export function grantsDanger(entry: AuditLogEvent, roles: readonly RoleRef[]): boolean {
  if (entry.action === Audit.RoleUpdate) {
    const change = entry.changes.find((item) => item.key === 'permissions');
    if (!change) return false;
    const before = new Set(permissionNames(String(change.before ?? '0')));
    return permissionNames(String(change.after ?? '0')).some(
      (name) => dangerous.includes(name) && !before.has(name),
    );
  }
  if (entry.action === Audit.MemberRoleUpdate) {
    const added = entry.changes.find((item) => item.key === '$add');
    const list = Array.isArray(added?.after) ? (added.after as { id?: unknown }[]) : [];
    return list.some((item) => {
      const role = roles.find((entry) => entry.id === String(item.id));
      return role ? hasDangerous(role.permissions) : false;
    });
  }
  return false;
}

export interface Strike {
  at: number;
  targetId: string | null;
}

export class ActionCounter {
  readonly #entries = new Map<string, Strike[]>();

  add(key: string, strike: Strike, windowMs: number): Strike[] {
    const list = (this.#entries.get(key) ?? []).filter((entry) => entry.at > strike.at - windowMs);
    list.push(strike);
    this.#entries.delete(key);
    while (this.#entries.size >= ACTOR_CAP) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    this.#entries.set(key, list);
    return list;
  }

  peek(key: string): Strike[] | undefined {
    return this.#entries.get(key);
  }

  take(key: string, since = Number.NEGATIVE_INFINITY): Strike[] {
    const list = this.#entries.get(key) ?? [];
    this.#entries.delete(key);
    return list.filter((entry) => entry.at > since);
  }
}

export interface NukeHooks {
  stopped?(guildId: string, report: NukeReport): Promise<unknown>;
}

export interface Stopped {
  stripped: number;
  removed: 'kick' | 'ban' | null;
  failed: boolean;
}

export class NukeWatch {
  readonly counter = new ActionCounter();
  readonly #handled = new Map<string, number>();
  readonly #pending = new Map<string, PendingRestore>();
  readonly #restored = new Map<string, number>();
  readonly #stoppedAgain = new Map<string, number>();
  hooks: NukeHooks = {};

  constructor(
    private readonly ctx: Ctx,
    private readonly store: SecurityStore,
    private readonly backups: BackupStore,
    private readonly guard: Guard,
    private readonly now: () => number = Date.now,
    private readonly quietMs = RESTORE_QUIET,
  ) {}

  async onAuditLog(entry: AuditLogEvent): Promise<void> {
    const { platform } = this.ctx.services;
    const actorId = entry.actorId;
    if (!actorId || actorId === platform.selfId) return;
    const config = await this.ctx.config(entry.guildId);
    const settings = config.nuke;
    if (!settings.enabled) return;
    if (settings.trustedUserIds.includes(actorId)) return;

    let key: NukeLimitKey | undefined = SIMPLE[entry.action];
    if (!key && (entry.action === Audit.RoleUpdate || entry.action === Audit.MemberRoleUpdate)) {
      const roles = await platform.roles(entry.guildId).catch(() => [] as RoleRef[]);
      if (grantsDanger(entry, roles)) key = 'dangerousGrant';
    }
    if (!key) return;

    const at = this.now();
    const windowMs = settings.windowSeconds * 1000;
    const handledKey = `${entry.guildId}:${actorId}`;
    const last = this.#handled.get(handledKey);
    if (last !== undefined && at - last < windowMs) {
      if (settings.restore && entry.targetId) {
        if (key === 'channelDelete')
          this.#queueRestore(entry.guildId, actorId, [entry.targetId], []);
        if (key === 'roleDelete') this.#queueRestore(entry.guildId, actorId, [], [entry.targetId]);
      }
      await this.#stopAgain(entry.guildId, actorId, key, settings, at);
      return;
    }
    const counterKey = `${entry.guildId}:${actorId}:${key}`;
    const strikes = this.counter.add(counterKey, { at, targetId: entry.targetId }, windowMs);
    if (strikes.length < settings.limits[key]) return;
    if (await this.#exempt(entry.guildId, actorId, settings)) return;
    this.#handled.set(handledKey, at);
    this.#stoppedAgain.set(handledKey, at);
    if (this.#handled.size > ACTOR_CAP) {
      const first = this.#handled.keys().next().value;
      if (first !== undefined) this.#handled.delete(first);
    }

    const since = at - windowMs;
    const deletedChannels = this.#targets(entry.guildId, actorId, 'channelDelete', key, since);
    const deletedRoles = this.#targets(entry.guildId, actorId, 'roleDelete', key, since);
    this.counter.take(counterKey);
    await this.respond(
      entry.guildId,
      actorId,
      key,
      strikes.length,
      settings,
      deletedChannels,
      deletedRoles,
    );
  }

  #targets(
    guildId: string,
    actorId: string,
    wanted: NukeLimitKey,
    key: NukeLimitKey,
    since: number,
  ): string[] {
    const list =
      key === wanted
        ? (this.counter.peek(`${guildId}:${actorId}:${wanted}`) ?? [])
        : this.counter.take(`${guildId}:${actorId}:${wanted}`, since);
    return list.map((strike) => strike.targetId).filter((id): id is string => !!id);
  }

  async #stopAgain(
    guildId: string,
    actorId: string,
    key: NukeLimitKey,
    settings: NukeSettings,
    at: number,
  ): Promise<void> {
    const throttleKey = `${guildId}:${actorId}`;
    const last = this.#stoppedAgain.get(throttleKey);
    if (last !== undefined && at - last < RESTRIKE_GAP) return;
    this.#stoppedAgain.set(throttleKey, at);
    if (this.#stoppedAgain.size > ACTOR_CAP) {
      const first = this.#stoppedAgain.keys().next().value;
      if (first !== undefined) this.#stoppedAgain.delete(first);
    }
    if (await this.#exempt(guildId, actorId, settings)) return;
    const user = await this.ctx.services.platform.user(actorId);
    const mode = user?.bot ? settings.botResponse : settings.response;
    await this.stop(guildId, actorId, mode, reasons.nuke(key, 1));
  }

  async #exempt(guildId: string, actorId: string, settings: NukeSettings): Promise<boolean> {
    const { platform } = this.ctx.services;
    const owner = await platform.guildOwner(guildId);
    if (owner === actorId) return true;
    if (settings.trustedRoleIds.length === 0) return false;
    const member = await platform.member(guildId, actorId).catch(() => null);
    return member ? member.roles.some((roleId) => settings.trustedRoleIds.includes(roleId)) : false;
  }

  async respond(
    guildId: string,
    actorId: string,
    key: NukeLimitKey,
    count: number,
    settings: NukeSettings,
    deletedChannels: string[],
    deletedRoles: string[],
  ): Promise<Stopped> {
    const { platform } = this.ctx.services;
    const user = await platform.user(actorId);
    const mode = user?.bot ? settings.botResponse : settings.response;
    const reason = reasons.nuke(key, count);
    const stopped = await this.stop(guildId, actorId, mode, reason);

    const restore =
      settings.restore && (deletedChannels.length > 0 || deletedRoles.length > 0)
        ? await this.#backedUp(guildId, deletedChannels, deletedRoles)
        : null;
    if (restore) this.#queueRestore(guildId, actorId, deletedChannels, deletedRoles);

    const config = await this.ctx.config(guildId);
    const restoreCounts = restore ? { channels: restore.channels, roles: restore.roles } : null;
    await this.store.event({
      guildId,
      kind: 'nuke',
      userId: null,
      actorId,
      summary: `${key} x${count}`,
      detail: { key, count, ...stopped, restore: restoreCounts, deletedChannels, deletedRoles },
    });
    await this.hooks.stopped?.(guildId, {
      actorId,
      key,
      count,
      removed: stopped.removed,
      stripped: stopped.stripped,
      deletedChannels,
      deletedRoles,
      restored: restore?.ids ?? [],
    });
    await this.guard.post(guildId, config, {
      ping: true,
      embed: {
        color: palette.danger,
        title: copy.nuke.title,
        description: lines(
          copy.nuke.line(actorId, copy.nuke.what[key] ?? key, count, settings.windowSeconds),
          '',
          stopped.stripped > 0 ? copy.nuke.stripped(stopped.stripped) : null,
          stopped.removed === 'kick' ? copy.nuke.kicked : null,
          stopped.removed === 'ban' ? copy.nuke.banned : null,
          stopped.failed ? copy.nuke.failed : null,
          restore
            ? restore.channels + restore.roles > 0
              ? copy.nuke.restoring(restore.channels, restore.roles)
              : copy.nuke.noBackup
            : null,
        ),
        timestamp: new Date(this.now()),
      },
    });
    return stopped;
  }

  async stop(
    guildId: string,
    actorId: string,
    mode: NukeSettings['response'],
    reason: string,
  ): Promise<Stopped> {
    const { platform, log } = this.ctx.services;
    const result: Stopped = { stripped: 0, removed: null, failed: false };
    const [member, roles, self] = await Promise.all([
      platform.member(guildId, actorId).catch(() => null),
      platform.roles(guildId).catch(() => [] as RoleRef[]),
      platform.selfId ? platform.member(guildId, platform.selfId).catch(() => null) : null,
    ]);
    const top = Math.max(
      0,
      ...(self?.roles ?? []).map((id) => roles.find((role) => role.id === id)?.position ?? 0),
    );
    if (member) {
      const strip = member.roles
        .map((id) => roles.find((role) => role.id === id))
        .filter(
          (role): role is RoleRef => !!role && !role.managed && hasDangerous(role.permissions),
        );
      for (const role of strip) {
        if (role.position >= top) {
          result.failed = true;
          continue;
        }
        try {
          await platform.removeRole(guildId, actorId, role.id, reason);
          result.stripped++;
        } catch (error) {
          result.failed = true;
          log.warn({ err: error, guild: guildId }, 'nuke role strip failed');
        }
      }
    }
    if (mode === 'kick' || mode === 'ban') {
      try {
        if (mode === 'ban') await platform.ban(guildId, actorId, { reason });
        else await platform.kick(guildId, actorId, reason);
        if (mode === 'ban') await this.guard.share(guildId, actorId, 'nuke');
        result.removed = mode;
        result.failed = false;
      } catch (error) {
        result.failed = true;
        log.warn({ err: error, guild: guildId }, 'nuke removal failed');
      }
    }
    return result;
  }

  async #backedUp(
    guildId: string,
    channelIds: readonly string[],
    roleIds: readonly string[],
  ): Promise<{ channels: number; roles: number; ids: string[] }> {
    const found = { channels: 0, roles: 0, ids: [] as string[] };
    for (const id of new Set(channelIds)) {
      if (!(await this.backups.findChannel(guildId, id).catch(() => null))) continue;
      found.channels++;
      found.ids.push(id);
    }
    for (const id of new Set(roleIds)) {
      if (!(await this.backups.findRole(guildId, id).catch(() => null))) continue;
      found.roles++;
      found.ids.push(id);
    }
    return found;
  }

  #queueRestore(
    guildId: string,
    actorId: string,
    channelIds: readonly string[],
    roleIds: readonly string[],
  ): void {
    const key = `${guildId}:${actorId}`;
    const now = this.now();
    const entry = this.#pending.get(key) ?? {
      channels: new Set<string>(),
      roles: new Set<string>(),
      first: now,
      timer: null,
    };
    this.#pending.set(key, entry);
    for (const [id, at] of this.#restored) {
      if (now - at <= RESTORE_MEMORY) break;
      this.#restored.delete(id);
    }
    const fresh = (id: string) => {
      const seen = `${guildId}:${id}`;
      if (this.#restored.has(seen)) return false;
      this.#restored.set(seen, now);
      return true;
    };
    for (const id of channelIds) if (fresh(id)) entry.channels.add(id);
    for (const id of roleIds) if (fresh(id)) entry.roles.add(id);
    if (entry.channels.size === 0 && entry.roles.size === 0) {
      this.#pending.delete(key);
      return;
    }
    if (entry.timer) clearTimeout(entry.timer);
    const wait = Math.max(0, Math.min(this.quietMs, entry.first + RESTORE_MAX - now));
    entry.timer = setTimeout(() => {
      this.#pending.delete(key);
      this.#restore(guildId, [...entry.channels], [...entry.roles]).catch((error) =>
        this.ctx.services.log.warn({ err: error, guild: guildId }, 'nuke restore failed'),
      );
    }, wait);
  }

  async #restore(
    guildId: string,
    channelIds: readonly string[],
    roleIds: readonly string[],
  ): Promise<{ channels: number; roles: number; ids: string[] }> {
    const plans = new Map<string, { roles: string[]; channels: string[] }>();
    const plan = (snapshotId: string) => {
      const entry = plans.get(snapshotId) ?? { roles: [], channels: [] };
      plans.set(snapshotId, entry);
      return entry;
    };
    for (const id of new Set(channelIds)) {
      const found = await this.backups.findChannel(guildId, id).catch(() => null);
      if (found) plan(found.snapshotId).channels.push(id);
    }
    for (const id of new Set(roleIds)) {
      const found = await this.backups.findRole(guildId, id).catch(() => null);
      if (found) plan(found.snapshotId).roles.push(id);
    }
    let channels = 0;
    let roles = 0;
    const ids: string[] = [];
    for (const [snapshotId, entry] of plans) {
      channels += entry.channels.length;
      roles += entry.roles.length;
      ids.push(...entry.channels, ...entry.roles);
      await this.ctx.services.jobs.enqueue({
        kind: 'backups.restore',
        guildId,
        payload: {
          snapshotId,
          scope: 'pick',
          roles: entry.roles,
          channels: entry.channels,
          modules: [],
          by: maxwell.id,
          automatic: true,
        },
      });
    }
    return { channels, roles, ids };
  }
}
