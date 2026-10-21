import type { Job } from '@maxwell/core';
import { maxwell } from '@maxwell/core';
import type { RolesConfig, rolesConfig } from '@maxwell/core/modules/roles';
import type { RolesStore } from '@maxwell/core/stores/roles';
import type {
  IncomingMessage,
  MemberJoin,
  MemberLeave,
  MemberRef,
  MemberUpdate,
} from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { Recent } from './cache.js';
import { audit, reasons } from './copy.js';
import {
  HOLD_SETTLE,
  type Holds,
  releasedFromGate,
  waitKey,
  waitPrefix,
  waitUntil,
} from './held.js';
import { assignable, sameSet, stickyRoles } from './plan.js';

type Ctx = ModuleContext<typeof rolesConfig>;

const DAY = 24 * 60 * 60_000;
const SWEEP_EVERY = 60 * 60_000;
const SWEEP_BATCH = 200;

interface AutoPayload {
  userId: string;
  roleIds: string[];
  since: number;
}

interface StickyPayload extends AutoPayload {
  name: string;
}

export function autoroleIds(config: RolesConfig, bot: boolean): string[] {
  return [...new Set(bot ? config.autoroles.botRoleIds : config.autoroles.roleIds)];
}

export function tracksMembers(config: RolesConfig): boolean {
  return config.sticky.enabled || config.timeRoles.length > 0;
}

export function nextSweep(guildId: string, now: number): number {
  const offset = Number(BigInt(guildId) % BigInt(SWEEP_EVERY));
  const base = Math.floor((now - offset) / SWEEP_EVERY) * SWEEP_EVERY + offset;
  return base + SWEEP_EVERY;
}

function ids(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : null;
}

function autoPayload(job: Job): AutoPayload | null {
  const { userId, since } = job.payload;
  const roleIds = ids(job.payload.roleIds);
  if (typeof userId !== 'string' || !roleIds) return null;
  return { userId, roleIds, since: typeof since === 'number' ? since : job.runAt.getTime() };
}

export class Members {
  readonly #sticky = new Recent<string[]>(50_000, 60 * 60_000);
  readonly #seen = new Recent<true>(50_000, 60 * 60_000);
  readonly #scheduled = new Recent<true>(20_000, SWEEP_EVERY);

  constructor(
    private readonly ctx: Ctx,
    private readonly store: RolesStore,
    private readonly holds: Holds,
  ) {}

  async onJoin(join: MemberJoin): Promise<void> {
    const { guildId, user } = join;
    const config = await this.ctx.config(guildId);
    const tracking = tracksMembers(config);
    const before = tracking ? await this.store.recordJoin(guildId, user.id, join.joinedAt) : null;
    if (tracking) {
      this.#seen.set(`${guildId}:${user.id}`, true);
      await this.scheduleSweep(guildId);
    }

    const since = join.joinedAt.getTime();
    const roleIds = autoroleIds(config, user.bot);
    const restore =
      config.sticky.enabled && before?.leftAt && before.stickyRoleIds.length > 0
        ? before.stickyRoleIds
        : null;
    if (roleIds.length === 0 && !restore) return;

    const settle = !user.bot && (await this.holds.watching(guildId)) ? HOLD_SETTLE : 0;
    const delay = Math.max(config.autoroles.delayMinutes * 60_000, settle);
    if (roleIds.length > 0) {
      const payload: AutoPayload = { userId: user.id, roleIds, since };
      if (delay === 0) await this.#autoroles(guildId, payload);
      else {
        await this.ctx.schedule('auto.grant', {
          guildId,
          payload: { ...payload },
          runAt: new Date(since + delay),
          dedupeKey: `roles.auto:${guildId}:${user.id}:${since}`,
        });
      }
    }

    if (restore) {
      const payload: StickyPayload = {
        userId: user.id,
        roleIds: restore,
        name: user.displayName,
        since,
      };
      if (settle === 0) await this.#stickyRestore(guildId, payload);
      else {
        await this.ctx.schedule('sticky.restore', {
          guildId,
          payload: { ...payload },
          runAt: new Date(Date.now() + settle),
          dedupeKey: `roles.sticky:${guildId}:${user.id}:${since}`,
        });
      }
    }
  }

  async onLeave(leave: MemberLeave): Promise<void> {
    await this.store.recordLeave(leave.guildId, leave.userId);
    this.forgetCached(leave.guildId, leave.userId);
  }

  forgetCached(guildId: string, userId: string): void {
    this.#seen.delete(`${guildId}:${userId}`);
    this.#sticky.delete(`${guildId}:${userId}`);
  }

  async onUpdate(update: MemberUpdate): Promise<void> {
    const { guildId } = update;
    if (await releasedFromGate(this.holds, update)) {
      await this.holds.wake(waitPrefix('roles', guildId, update.user.id));
    }
    const config = await this.ctx.config(guildId);
    if (!config.sticky.enabled) return;
    const gateRole = await this.holds.gateRole(guildId);
    if (gateRole && update.roles.includes(gateRole)) return;
    await this.#snapshot(guildId, update.user.id, update.roles, config);
  }

  async onMessage(message: IncomingMessage): Promise<void> {
    const guildId = message.guildId;
    if (!guildId || message.author.bot || message.fromWebhook) return;
    const key = `${guildId}:${message.author.id}`;
    const config = await this.ctx.config(guildId);
    if (!tracksMembers(config)) return;
    await this.scheduleSweep(guildId);

    if (config.sticky.enabled) {
      const gateRole = await this.holds.gateRole(guildId);
      if (!gateRole || !message.memberRoles.includes(gateRole)) {
        await this.#snapshot(guildId, message.author.id, message.memberRoles, config);
      }
    }
    if (config.timeRoles.length === 0 || this.#seen.has(key)) return;
    this.#seen.set(key, true);
    const member = await this.ctx.services.platform.member(guildId, message.author.id);
    if (member) await this.store.recordSeen(guildId, message.author.id, member.joinedAt);
  }

  async grantDelayed(job: Job): Promise<void> {
    const guildId = job.guildId;
    const payload = autoPayload(job);
    if (!guildId || !payload) return;
    if (!(await this.ctx.enabled(guildId))) return;
    await this.#autoroles(guildId, payload);
  }

  async restoreDelayed(job: Job): Promise<void> {
    const guildId = job.guildId;
    const payload = autoPayload(job);
    const name = job.payload.name;
    if (!guildId || !payload) return;
    if (!(await this.ctx.enabled(guildId))) return;
    await this.#stickyRestore(guildId, {
      ...payload,
      name: typeof name === 'string' ? name : payload.userId,
    });
  }

  async #autoroles(guildId: string, payload: AutoPayload): Promise<void> {
    const member = await this.ctx.services.platform.member(guildId, payload.userId);
    if (!member) return;
    if (await this.holds.held(guildId, payload.userId, member.roles)) {
      await this.#wait('auto.grant', guildId, 'auto', payload);
      return;
    }
    const config = await this.ctx.config(guildId);
    const allowed = new Set([...config.autoroles.roleIds, ...config.autoroles.botRoleIds]);
    await this.#give(
      guildId,
      member,
      payload.roleIds.filter((id) => allowed.has(id)),
      reasons.autorole,
    );
  }

  async #stickyRestore(guildId: string, payload: StickyPayload): Promise<void> {
    const config = await this.ctx.config(guildId);
    if (!config.sticky.enabled) return;
    const member = await this.ctx.services.platform.member(guildId, payload.userId);
    if (!member) return;
    if (await this.holds.held(guildId, payload.userId, member.roles)) {
      await this.#wait('sticky.restore', guildId, 'sticky', payload);
      return;
    }
    await this.#restore(guildId, member, payload.name, payload.roleIds, config);
  }

  async #wait(
    kind: string,
    guildId: string,
    what: string,
    payload: AutoPayload | StickyPayload,
  ): Promise<void> {
    const runAt = waitUntil(payload.since);
    if (!runAt) return;
    await this.ctx.schedule(kind, {
      guildId,
      payload: { ...payload },
      runAt,
      dedupeKey: waitKey('roles', guildId, payload.userId, what),
    });
  }

  async sweep(job: Job): Promise<void> {
    const guildId = job.guildId;
    if (!guildId || !(await this.ctx.enabled(guildId))) return;
    const config = await this.ctx.config(guildId);
    if (!tracksMembers(config)) return;
    try {
      await this.#timeRoles(guildId, config);
      await this.store.pruneLeft(guildId, new Date(Date.now() - config.sticky.retentionDays * DAY));
    } finally {
      await this.scheduleSweep(guildId);
    }
  }

  async seedSweeps(): Promise<void> {
    const local = new Set(this.ctx.services.platform.guildIds());
    for (const guildId of await this.store.configuredGuilds()) {
      if (!local.has(guildId) || !(await this.ctx.enabled(guildId))) continue;
      if (tracksMembers(await this.ctx.config(guildId))) await this.scheduleSweep(guildId);
    }
  }

  async scheduleSweep(guildId: string, now = Date.now()): Promise<void> {
    const runAt = nextSweep(guildId, now);
    const key = `${guildId}:${runAt}`;
    if (this.#scheduled.has(key)) return;
    this.#scheduled.set(key, true);
    await this.ctx.schedule('time.sweep', {
      guildId,
      runAt: new Date(runAt),
      dedupeKey: `roles.sweep:${guildId}:${runAt}`,
    });
  }

  async revertSticky(guildId: string, userId: string, roleIds: string[]): Promise<void> {
    const { platform } = this.ctx.services;
    const member = await platform.member(guildId, userId);
    if (!member) return;
    for (const roleId of roleIds) {
      if (!member.roles.includes(roleId)) continue;
      await platform.removeRole(guildId, userId, roleId, reasons.stickyUndo);
    }
  }

  async #timeRoles(guildId: string, config: RolesConfig): Promise<void> {
    const { platform, log } = this.ctx.services;
    for (const { roleId, days } of config.timeRoles) {
      const due = await this.store.dueForTimeRole(
        guildId,
        roleId,
        new Date(Date.now() - days * DAY),
        SWEEP_BATCH,
      );
      for (const userId of due) {
        const member = await platform.member(guildId, userId);
        if (!member) {
          await this.store.recordLeave(guildId, userId);
          continue;
        }
        if (await this.holds.held(guildId, userId, member.roles)) continue;
        if (!member.roles.includes(roleId)) {
          try {
            await platform.addRole(guildId, userId, roleId, reasons.timeRole);
          } catch (error) {
            log.warn({ err: error, guild: guildId, role: roleId }, 'time role could not be given');
            break;
          }
        }
        await this.store.markTimeGranted(guildId, userId, roleId);
      }
    }
  }

  async #snapshot(
    guildId: string,
    userId: string,
    roles: readonly string[],
    config: RolesConfig,
  ): Promise<void> {
    const key = `${guildId}:${userId}`;
    const next = stickyRoles(config.sticky, roles, guildId);
    const known = this.#sticky.get(key);
    if (known && sameSet(known, next)) return;
    this.#sticky.set(key, next);
    await this.store.setSticky(guildId, userId, next);
  }

  async #restore(
    guildId: string,
    member: MemberRef,
    name: string,
    saved: string[],
    config: RolesConfig,
  ): Promise<void> {
    const { platform, log } = this.ctx.services;
    const userId = member.user.id;
    const gateRole = await this.holds.gateRole(guildId);
    const wanted = stickyRoles(config.sticky, saved, guildId).filter((id) => id !== gateRole);
    if (wanted.length === 0) return;
    const [roles, self] = await Promise.all([
      platform.roles(guildId).catch(() => []),
      platform.selfId ? platform.member(guildId, platform.selfId) : Promise.resolve(null),
    ]);
    const roleIds = assignable(wanted, roles, self?.roles ?? null, guildId);
    const given = await this.#give(guildId, member, roleIds, reasons.sticky);
    if (given.length === 0) return;
    log.debug({ guild: guildId, user: userId, roles: given.length }, 'sticky roles restored');
    await this.ctx.record(
      guildId,
      maxwell,
      'sticky.restore',
      audit.stickyRestored(name, given.length),
      {
        after: { userId, roleIds: given },
        undo: { kind: 'sticky.revert', payload: { userId, roleIds: given } },
      },
    );
  }

  async #give(
    guildId: string,
    member: MemberRef,
    roleIds: readonly string[],
    reason: string,
  ): Promise<string[]> {
    if (roleIds.length === 0) return [];
    const { platform, log } = this.ctx.services;
    const given: string[] = [];
    for (const roleId of roleIds) {
      if (member.roles.includes(roleId)) continue;
      try {
        await platform.addRole(guildId, member.user.id, roleId, reason);
        given.push(roleId);
      } catch (error) {
        log.warn({ err: error, guild: guildId, role: roleId }, 'role could not be given');
      }
    }
    return given;
  }
}
