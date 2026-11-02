import { ACTIVITY_DAYS, type RolesConfig, type rolesConfig } from '@maxwell/core/modules/roles';
import type { ActivityCount, RolesStore } from '@maxwell/core/stores/roles';
import type { IncomingMessage } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { reasons } from './copy.js';
import type { Holds } from './held.js';

type Ctx = ModuleContext<typeof rolesConfig>;

const DAY = 86_400_000;
const BATCH = 500;
const BUFFER_LIMIT = 20_000;

export function dayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

export function sinceDay(days: number, now: number): string {
  return dayOf(now - (days - 1) * DAY);
}

export class ActivityRoles {
  readonly #counts = new Map<string, ActivityCount>();
  #flushing: Promise<number> | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly store: RolesStore,
    private readonly holds: Holds,
  ) {}

  count(message: IncomingMessage, now = Date.now()): void {
    const guildId = message.guildId;
    if (!guildId || message.author.bot || message.fromWebhook) return;
    const day = dayOf(now);
    const key = `${guildId}:${message.author.id}:${day}`;
    const known = this.#counts.get(key);
    if (known) {
      known.messages++;
      return;
    }
    this.#counts.set(key, { guildId, userId: message.author.id, day, messages: 1 });
    if (this.#counts.size >= BUFFER_LIMIT) void this.flush();
  }

  flush(): Promise<number> {
    if (this.#flushing) return this.#flushing;
    const rows = [...this.#counts.values()];
    this.#counts.clear();
    if (rows.length === 0) return Promise.resolve(0);
    this.#flushing = this.store
      .addActivity(rows)
      .catch((error) => {
        this.ctx.services.log.warn({ err: error, rows: rows.length }, 'activity flush failed');
        return 0;
      })
      .finally(() => {
        this.#flushing = null;
      });
    return this.#flushing;
  }

  async sweep(guildId: string, config: RolesConfig, now = Date.now()): Promise<void> {
    await this.flush();
    await this.store.keepActivityRoles(
      guildId,
      config.activityRoles.map((rule) => rule.roleId),
    );
    for (const rule of config.activityRoles) {
      await this.#rule(guildId, rule, now);
    }
    await this.store.pruneActivity(guildId, sinceDay(ACTIVITY_DAYS, now));
  }

  async #rule(
    guildId: string,
    rule: RolesConfig['activityRoles'][number],
    now: number,
  ): Promise<void> {
    const { platform, log } = this.ctx.services;
    const active = new Set(
      await this.store.activeMembers(guildId, sinceDay(rule.days, now), rule.messages),
    );
    const granted = new Set(await this.store.activityGranted(guildId, rule.roleId));

    let given = 0;
    for (const userId of active) {
      if (granted.has(userId) || given >= BATCH) continue;
      const member = await platform.member(guildId, userId);
      if (!member || (await this.holds.held(guildId, userId, member.roles))) continue;
      if (!member.roles.includes(rule.roleId)) {
        try {
          await platform.addRole(guildId, userId, rule.roleId, reasons.activityRole);
        } catch (error) {
          log.warn({ err: error, guild: guildId, role: rule.roleId }, 'activity role not given');
          return;
        }
      }
      await this.store.markActivityGranted(guildId, rule.roleId, userId);
      given++;
    }

    for (const userId of granted) {
      if (active.has(userId)) continue;
      const member = await platform.member(guildId, userId);
      if (member?.roles.includes(rule.roleId)) {
        try {
          await platform.removeRole(guildId, userId, rule.roleId, reasons.activityRoleEnded);
        } catch (error) {
          log.warn({ err: error, guild: guildId, role: rule.roleId }, 'activity role not removed');
          return;
        }
      }
      await this.store.dropActivityGrant(guildId, rule.roleId, userId);
    }
  }
}
