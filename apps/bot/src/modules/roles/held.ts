import type { Sql } from '@maxwell/core';
import { automodConfig } from '@maxwell/core/modules/automod';
import { securityConfig } from '@maxwell/core/modules/security';
import { AutomodStore } from '@maxwell/core/stores/automod';
import { RolesStore } from '@maxwell/core/stores/roles';
import type { Logger } from '../../log.js';
import type { MemberUpdate } from '../../platform/types.js';
import type { Settings } from '../../runtime/settings.js';

export const HOLD_SETTLE = 15_000;
export const HOLD_RECHECK = 5 * 60_000;
export const HOLD_LIMIT = 14 * 24 * 60 * 60_000;
export const HOLD_WAKE = 5_000;

export interface Holds {
  watching(guildId: string): Promise<boolean>;
  gateRole(guildId: string): Promise<string | null>;
  held(guildId: string, userId: string, roles?: readonly string[]): Promise<boolean>;
  wake(prefix: string): Promise<void>;
}

export const noHolds: Holds = {
  watching: async () => false,
  gateRole: async () => null,
  held: async () => false,
  wake: async () => {},
};

export function waitPrefix(module: string, guildId: string, userId: string): string {
  return `${module}.wait:${guildId}:${userId}`;
}

export function waitKey(module: string, guildId: string, userId: string, what: string): string {
  return `${waitPrefix(module, guildId, userId)}:${what}`;
}

export function removedRoles(update: MemberUpdate): string[] {
  if (!update.before) return [];
  return update.before.roles.filter((roleId) => !update.roles.includes(roleId));
}

export async function releasedFromGate(holds: Holds, update: MemberUpdate): Promise<boolean> {
  const removed = removedRoles(update);
  if (removed.length === 0) return false;
  const gateRole = await holds.gateRole(update.guildId);
  return gateRole !== null && removed.includes(gateRole);
}

export function waitUntil(since: number, now = Date.now()): Date | null {
  return now - since > HOLD_LIMIT ? null : new Date(now + HOLD_RECHECK);
}

export class AutomodHolds implements Holds {
  readonly #automod: AutomodStore;
  readonly #roles: RolesStore;

  constructor(
    sql: Sql,
    private readonly settings: Settings,
    private readonly log: Logger,
  ) {
    this.#automod = new AutomodStore(sql);
    this.#roles = new RolesStore(sql);
  }

  async #raid(guildId: string) {
    return (await this.settings.config(guildId, 'automod', automodConfig)).raid;
  }

  async watching(guildId: string): Promise<boolean> {
    const raid = await this.#raid(guildId);
    if (raid.gateRoleId === null) return false;
    if (raid.enabled && (await this.settings.enabled(guildId, 'automod'))) return true;
    if (!(await this.settings.enabled(guildId, 'security'))) return false;
    const security = await this.settings.config(guildId, 'security', securityConfig);
    return security.verification.enabled || security.raid.enabled;
  }

  async gateRole(guildId: string): Promise<string | null> {
    return (await this.#raid(guildId)).gateRoleId;
  }

  async held(guildId: string, userId: string, roles?: readonly string[]): Promise<boolean> {
    if (roles) {
      const gateRole = await this.gateRole(guildId);
      if (gateRole && roles.includes(gateRole)) return true;
    }
    try {
      return await this.#automod.isHeld(guildId, userId);
    } catch (error) {
      this.log.debug({ err: error, guild: guildId }, 'gate hold lookup failed');
      return false;
    }
  }

  async wake(prefix: string): Promise<void> {
    await this.#roles.wakeJobs(prefix, new Date(Date.now() + HOLD_WAKE));
  }
}
