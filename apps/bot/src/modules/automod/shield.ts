import { type Actor, cancel, maxwell } from '@maxwell/core';
import type { AutomodStore, HoldReason, Incident } from '@maxwell/core/stores/automod';
import { ShieldStore } from '@maxwell/core/stores/shield';
import { formatDuration } from '../../commands/duration.js';
import { mention } from '../../commands/mentions.js';
import type { ChannelChange, MemberJoin, MemberUpdate } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { lines, snowflakeDate, subtext, timestamp } from '../../ui/format.js';
import { InboxFeed } from '../moderation/feed.js';
import { audit, copy } from './copy.js';
import type { AutomodConfig, automodConfig, RaidShieldConfig } from './types.js';

type Ctx = ModuleContext<typeof automodConfig>;

const JOIN_CAP = 1_000;
const GUILD_CAP = 10_000;
const ACTIVE_TTL = 15_000;

export interface JoinEntry {
  at: number;
  userId: string;
}

export class JoinWindow {
  readonly #guilds = new Map<string, JoinEntry[]>();

  push(guildId: string, entry: JoinEntry, seconds: number): JoinEntry[] {
    let list = this.#guilds.get(guildId);
    if (list) {
      this.#guilds.delete(guildId);
    } else {
      list = [];
      while (this.#guilds.size >= GUILD_CAP) {
        const oldest = this.#guilds.keys().next().value;
        if (oldest === undefined) break;
        this.#guilds.delete(oldest);
      }
    }
    const since = entry.at - seconds * 1000;
    const fresh = list.filter((item) => item.at > since && item.userId !== entry.userId);
    fresh.push(entry);
    if (fresh.length > JOIN_CAP) fresh.splice(0, fresh.length - JOIN_CAP);
    this.#guilds.set(guildId, fresh);
    return fresh;
  }

  clear(guildId: string): void {
    this.#guilds.delete(guildId);
  }

  get size(): number {
    return this.#guilds.size;
  }
}

export function endJobKey(incidentId: string): string {
  return `automod.lockdown.end:${incidentId}`;
}

export interface GateResult {
  done: string[];
  failed: string[];
}

export class RaidShield {
  readonly #feed: InboxFeed;
  readonly window = new JoinWindow();
  readonly #active = new Map<string, { incident: Incident | null; at: number }>();
  readonly #queues = new Map<string, Promise<void>>();

  constructor(
    private readonly ctx: Ctx,
    private readonly store: AutomodStore,
  ) {
    this.#feed = new InboxFeed(ctx.services);
  }

  onJoin(join: MemberJoin): Promise<void> {
    const previous = this.#queues.get(join.guildId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => this.#handleJoin(join))
      .finally(() => {
        if (this.#queues.get(join.guildId) === next) this.#queues.delete(join.guildId);
      });
    this.#queues.set(join.guildId, next);
    return next;
  }

  async #handleJoin(join: MemberJoin): Promise<void> {
    if (join.user.bot) return;
    const config = await this.ctx.config(join.guildId);
    const raid = config.raid;
    if (!raid.enabled) return;

    const now = Date.now();
    const recent = this.window.push(
      join.guildId,
      { at: now, userId: join.user.id },
      raid.perSeconds,
    );
    let incident = await this.active(join.guildId);
    if (incident?.endsAt && incident.endsAt.getTime() <= now) incident = null;

    if (!incident && recent.length >= raid.joins) {
      const started = await this.startLockdown(
        join.guildId,
        'raid',
        maxwell,
        raid.lockdownMinutes,
        {
          joins: recent.length,
          seconds: raid.perSeconds,
        },
      );
      for (const entry of recent) {
        await this.hold(join.guildId, entry.userId, started.id, 'raid', raid);
      }
      return;
    }

    if (incident) {
      await this.hold(join.guildId, join.user.id, incident.id, 'lockdown', raid);
      return;
    }

    if (raid.minAccountAgeHours > 0) {
      const age = join.joinedAt.getTime() - snowflakeDate(join.user.id).getTime();
      if (age < raid.minAccountAgeHours * 3_600_000) {
        await this.hold(join.guildId, join.user.id, null, 'account_age', raid);
      }
    }
  }

  async active(guildId: string): Promise<Incident | null> {
    const cached = this.#active.get(guildId);
    if (cached && Date.now() - cached.at < ACTIVE_TTL) return cached.incident;
    const incident = await this.store.activeIncident(guildId);
    this.#remember(guildId, incident);
    return incident;
  }

  #remember(guildId: string, incident: Incident | null): void {
    this.#active.delete(guildId);
    while (this.#active.size >= GUILD_CAP) {
      const oldest = this.#active.keys().next().value;
      if (oldest === undefined) break;
      this.#active.delete(oldest);
    }
    this.#active.set(guildId, { incident, at: Date.now() });
  }

  async hold(
    guildId: string,
    userId: string,
    incidentId: string | null,
    reason: HoldReason,
    raid: RaidShieldConfig,
  ): Promise<boolean> {
    if (!raid.gateRoleId) return false;
    try {
      await this.ctx.services.platform.addRole(guildId, userId, raid.gateRoleId, audit.gateReason);
    } catch (error) {
      this.ctx.services.log.warn({ err: error, guild: guildId }, 'gate role could not be added');
      return false;
    }
    const held = await this.store.hold(guildId, userId, incidentId, reason);
    if (held) await this.#feed.gate(guildId, (await this.store.held(guildId)).length);
    return held;
  }

  async startLockdown(
    guildId: string,
    reason: 'raid' | 'manual',
    by: Actor,
    minutes: number,
    trigger?: { joins: number; seconds: number },
  ): Promise<Incident> {
    const existing = await this.store.activeIncident(guildId);
    const endsAt = new Date(Date.now() + minutes * 60_000);
    if (existing) {
      await this.store.extendIncident(guildId, existing.id, endsAt);
      await cancel(this.ctx.services.sql, endJobKey(existing.id));
      await this.#scheduleEnd(guildId, existing.id, endsAt);
      const extended = { ...existing, endsAt };
      this.#remember(guildId, extended);
      return extended;
    }

    const incident = await this.store.startIncident(guildId, reason, by.id, endsAt);
    this.#remember(guildId, incident);
    await this.#scheduleEnd(guildId, incident.id, endsAt);

    const summary = trigger
      ? audit.auditIncident(trigger.joins, trigger.seconds)
      : audit.auditLockdown(formatDuration(minutes * 60_000));
    await this.ctx.record(guildId, by, 'automod.lockdown', summary, {
      after: { incidentId: incident.id, endsAt: endsAt.toISOString(), reason },
      undo: { kind: 'lockdown', payload: { incidentId: incident.id } },
    });

    const config = await this.ctx.config(guildId);
    await this.#alert(guildId, config, incident, trigger);
    return incident;
  }

  async #scheduleEnd(guildId: string, incidentId: string, endsAt: Date): Promise<void> {
    await this.ctx.schedule('lockdown.end', {
      guildId,
      runAt: endsAt,
      payload: { incidentId },
      dedupeKey: endJobKey(incidentId),
    });
  }

  async #alert(
    guildId: string,
    config: AutomodConfig,
    incident: Incident,
    trigger?: { joins: number; seconds: number },
  ): Promise<void> {
    const { platform, guilds, log } = this.ctx.services;
    if (!config.logChannelId) return;
    const until = incident.endsAt ? timestamp(incident.endsAt, 't') : '';
    const prefix = await guilds.prefix(guildId);
    const alertRole = config.raid.alertRoleId;
    const content = lines(
      alertRole ? mention.role(alertRole) : null,
      trigger ? copy.raidAlert(trigger.joins, trigger.seconds, until) : copy.lockdownStarted(until),
      config.raid.gateRoleId ? subtext(copy.gateHint(prefix)) : copy.raidNoGate,
    );
    await platform
      .send(config.logChannelId, { content, mentionRoles: alertRole ? [alertRole] : [] })
      .catch((error) => log.warn({ err: error, guild: guildId }, 'raid alert failed'));
  }

  async endLockdown(guildId: string, incidentId: string | null, by: Actor): Promise<boolean> {
    const incident = incidentId
      ? await this.store.incident(guildId, incidentId)
      : await this.store.activeIncident(guildId);
    if (!incident || incident.endedAt) return false;
    const ended = await this.store.endIncident(guildId, incident.id, by.id);
    this.#active.delete(guildId);
    if (!ended) return false;
    await cancel(this.ctx.services.sql, endJobKey(incident.id)).catch(() => false);
    if (by.id !== null) {
      await this.ctx.record(guildId, by, 'automod.lockdown.end', audit.auditLockdownEnd, {
        after: { incidentId: incident.id },
      });
    }
    const config = await this.ctx.config(guildId);
    if (config.logChannelId) {
      const held = (await this.store.held(guildId)).length;
      await this.ctx.services.platform
        .send(config.logChannelId, { content: copy.lockdownEnded(held), silent: true })
        .catch(() => undefined);
    }
    return true;
  }

  async letIn(guildId: string, userIds: readonly string[] | null, by: Actor): Promise<GateResult> {
    const config = await this.ctx.config(guildId);
    const roleId = config.raid.gateRoleId;
    const held = await this.store.held(guildId);
    const targets = held.filter((entry) => !userIds || userIds.includes(entry.userId));
    const done: string[] = [];
    const failed: string[] = [];
    const gone: string[] = [];
    const { platform, log } = this.ctx.services;
    for (const entry of targets) {
      if (!roleId) {
        done.push(entry.userId);
        continue;
      }
      try {
        await platform.removeRole(guildId, entry.userId, roleId, audit.gateReason);
        done.push(entry.userId);
      } catch (error) {
        const member = await platform.member(guildId, entry.userId).catch(() => undefined);
        if (member === null) gone.push(entry.userId);
        else {
          failed.push(entry.userId);
          log.warn({ err: error, guild: guildId }, 'gate role could not be removed');
        }
      }
    }
    await this.store.resolveHeld(guildId, done, 'let_in', by.id);
    await this.store.resolveHeld(guildId, gone, 'left', by.id);
    const remaining = (await this.store.held(guildId)).length;
    await this.#feed.gateClosed(guildId, remaining, 'let_in', by.id);
    if (done.length > 0) {
      await this.ctx.record(guildId, by, 'automod.gate.letin', audit.auditLetIn(done.length), {
        after: { userIds: done },
        undo: roleId ? { kind: 'gate.rehold', payload: { userIds: done, roleId } } : null,
      });
    }
    return { done, failed };
  }

  async banAll(guildId: string, userIds: readonly string[] | null, by: Actor): Promise<GateResult> {
    const held = await this.store.held(guildId);
    const targets = held.filter((entry) => !userIds || userIds.includes(entry.userId));
    const done: string[] = [];
    const failed: string[] = [];
    const { platform, log } = this.ctx.services;
    for (const entry of targets) {
      try {
        await platform.ban(guildId, entry.userId, { reason: audit.banReason });
        done.push(entry.userId);
      } catch (error) {
        failed.push(entry.userId);
        log.warn({ err: error, guild: guildId }, 'gate ban failed');
      }
    }
    await this.store.resolveHeld(guildId, done, 'banned', by.id);
    const shield = new ShieldStore(this.ctx.services.sql);
    for (const userId of done) {
      await shield.report(guildId, userId, 'raid', by.id).catch(() => false);
    }
    const remaining = (await this.store.held(guildId)).length;
    await this.#feed.gateClosed(guildId, remaining, 'banned', by.id);
    if (done.length > 0) {
      await this.ctx.record(guildId, by, 'automod.gate.banall', audit.auditBanAll(done.length), {
        after: { userIds: done },
        undo: { kind: 'gate.unban', payload: { userIds: done } },
      });
    }
    return { done, failed };
  }

  async rehold(guildId: string, userIds: readonly string[], roleId: string): Promise<void> {
    const { platform, log } = this.ctx.services;
    for (const userId of userIds) {
      try {
        await platform.addRole(guildId, userId, roleId, audit.gateReason);
        await this.store.hold(guildId, userId, null, 'lockdown');
      } catch (error) {
        log.warn({ err: error, guild: guildId }, 'gate role could not be added back');
      }
    }
    await this.#feed.gate(guildId, (await this.store.held(guildId)).length);
  }

  async onLeave(guildId: string, userId: string): Promise<void> {
    await this.store.resolveHeld(guildId, [userId], 'left', null);
    const remaining = (await this.store.held(guildId)).length;
    await this.#feed.gateClosed(guildId, remaining, 'left', null);
  }

  async onMemberUpdate(update: MemberUpdate): Promise<void> {
    if (!update.before) return;
    const config = await this.ctx.config(update.guildId);
    const roleId = config.raid.gateRoleId;
    if (!roleId) return;
    if (update.before.roles.includes(roleId) && !update.roles.includes(roleId)) {
      await this.store.resolveHeld(update.guildId, [update.user.id], 'let_in', null);
    }
  }

  async onChannelCreate(change: ChannelChange): Promise<void> {
    const config = await this.ctx.config(change.guildId);
    const { gateRoleId, gateChannelId, enabled } = config.raid;
    if (!enabled || !gateRoleId || change.channel.id === gateChannelId) return;
    await this.ctx.services.platform
      .setOverwrite(
        change.channel.id,
        { id: gateRoleId, type: 'role', allow: [], deny: ['ViewChannel'] },
        audit.gateReason,
      )
      .catch((error) =>
        this.ctx.services.log.warn({ err: error, guild: change.guildId }, 'gate overwrite failed'),
      );
  }

  async setupGate(guildId: string, by: Actor): Promise<string | null> {
    const { platform, log } = this.ctx.services;
    const config = await this.ctx.config(guildId);
    const roles = await platform.roles(guildId);
    let roleId = config.raid.gateRoleId;
    if (!roleId || !roles.some((role) => role.id === roleId)) {
      roleId = await platform.createRole(
        guildId,
        { name: audit.gateRoleName, permissions: [], mentionable: false, hoist: false },
        audit.gateReason,
      );
      await this.ctx.update(
        guildId,
        { raid: { ...config.raid, gateRoleId: roleId } },
        by,
        audit.auditGateSetup,
      );
      await this.ctx.record(guildId, by, 'automod.gate.role', audit.auditGateSetup, {
        after: { roleId },
        undo: { kind: 'gate.role', payload: { roleId } },
      });
    }
    const channels = await platform.channels(guildId);
    for (const channel of channels) {
      const inside = channel.id === config.raid.gateChannelId;
      await platform
        .setOverwrite(
          channel.id,
          inside
            ? { id: roleId, type: 'role', allow: ['ViewChannel', 'ReadMessageHistory'], deny: [] }
            : { id: roleId, type: 'role', allow: [], deny: ['ViewChannel'] },
          audit.gateReason,
        )
        .catch((error) => log.warn({ err: error, guild: guildId }, 'gate overwrite failed'));
    }
    return roleId;
  }
}
