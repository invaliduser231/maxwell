import type { Platform, RoleRef } from '../../platform/types.js';

const TTL = 5 * 60_000;
const MAX_GUILDS = 5_000;

const MOD_BITS = [1n, 2n, 3n, 5n, 13n, 40n];

export function modRoleSet(
  guildId: string,
  modRoleIds: readonly string[],
  roles: readonly RoleRef[],
): Set<string> {
  const set = new Set(modRoleIds);
  for (const role of roles) {
    if (role.id === guildId) continue;
    let bits: bigint;
    try {
      bits = BigInt(role.permissions || '0');
    } catch {
      continue;
    }
    if (MOD_BITS.some((bit) => (bits >> bit) & 1n)) set.add(role.id);
  }
  return set;
}

class TtlCache<T> {
  readonly #entries = new Map<string, { value: T; at: number }>();

  get(key: string): T | undefined {
    const hit = this.#entries.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > TTL) {
      this.#entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    this.#entries.delete(key);
    while (this.#entries.size >= MAX_GUILDS) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    this.#entries.set(key, { value, at: Date.now() });
  }

  delete(key: string): void {
    this.#entries.delete(key);
  }
}

export class GuildLookup {
  readonly #roles = new TtlCache<RoleRef[]>();
  readonly #parents = new TtlCache<Map<string, string | null>>();

  constructor(private readonly platform: Platform) {}

  async roles(guildId: string): Promise<RoleRef[]> {
    const cached = this.#roles.get(guildId);
    if (cached) return cached;
    const roles = await this.platform.roles(guildId).catch(() => []);
    this.#roles.set(guildId, roles);
    return roles;
  }

  async mods(guildId: string, modRoleIds: readonly string[]): Promise<Set<string>> {
    return modRoleSet(guildId, modRoleIds, await this.roles(guildId));
  }

  async isMod(
    guildId: string,
    modRoleIds: readonly string[],
    memberRoles: readonly string[],
  ): Promise<boolean> {
    if (memberRoles.length === 0) return false;
    const mods = await this.mods(guildId, modRoleIds);
    return memberRoles.some((role) => mods.has(role));
  }

  async parents(guildId: string): Promise<Map<string, string | null>> {
    const cached = this.#parents.get(guildId);
    if (cached) return cached;
    const channels = await this.platform.channels(guildId).catch(() => []);
    const map = new Map(channels.map((channel) => [channel.id, channel.parentId]));
    this.#parents.set(guildId, map);
    return map;
  }

  async parentOf(guildId: string, channelId: string): Promise<string | null> {
    return (await this.parents(guildId)).get(channelId) ?? null;
  }

  forgetRoles(guildId: string): void {
    this.#roles.delete(guildId);
  }

  forgetChannels(guildId: string): void {
    this.#parents.delete(guildId);
  }
}
