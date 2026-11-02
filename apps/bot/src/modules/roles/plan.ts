import type { RoleMenu, RolesConfig } from '@maxwell/core/modules/roles';
import type { RoleRef } from '../../platform/types.js';
import { normalizeEmoji, sameEmoji } from './emoji.js';

type Entry = RoleMenu['entries'][number];

export interface ReactionPlan {
  add: string[];
  remove: string[];
  unreact: string[];
  temporary: boolean;
}

const KEEP_ON_UNREACT = new Set<RoleMenu['type']>(['add', 'verify', 'remove', 'binding']);

export function findEntry(menu: RoleMenu, emoji: string): Entry | null {
  return menu.entries.find((entry) => sameEmoji(entry.emoji, emoji)) ?? null;
}

export function planReaction(
  menu: RoleMenu,
  entry: Entry,
  memberRoles: readonly string[],
  added: boolean,
): ReactionPlan {
  const has = new Set(memberRoles);
  const plan: ReactionPlan = { add: [], remove: [], unreact: [], temporary: false };

  const others = menu.entries.filter(
    (other) => other.roleId !== entry.roleId && has.has(other.roleId),
  );
  const own = normalizeEmoji(entry.emoji);
  const refuse = (): ReactionPlan => {
    if (own) plan.unreact.push(own);
    return plan;
  };

  if (!added) {
    if (!KEEP_ON_UNREACT.has(menu.type) && has.has(entry.roleId)) plan.remove.push(entry.roleId);
    return plan;
  }

  switch (menu.type) {
    case 'remove':
      if (has.has(entry.roleId)) plan.remove.push(entry.roleId);
      return refuse();
    case 'verify':
      if (!has.has(entry.roleId)) plan.add.push(entry.roleId);
      return refuse();
    case 'binding':
      if (others.length > 0) return refuse();
      break;
    case 'limit':
      if (!has.has(entry.roleId) && others.length >= menu.limit) return refuse();
      break;
  }

  if (menu.type === 'unique') {
    for (const other of menu.entries) {
      if (other.roleId === entry.roleId || !has.has(other.roleId)) continue;
      if (!plan.remove.includes(other.roleId)) plan.remove.push(other.roleId);
      const emoji = normalizeEmoji(other.emoji);
      if (emoji && !sameEmoji(other.emoji, entry.emoji) && !plan.unreact.includes(emoji)) {
        plan.unreact.push(emoji);
      }
    }
  }
  if (!has.has(entry.roleId)) plan.add.push(entry.roleId);
  plan.temporary = menu.type === 'temporary';
  return plan;
}

export function menuEmojis(menu: RoleMenu): string[] {
  const out: string[] = [];
  for (const entry of menu.entries) {
    const emoji = normalizeEmoji(entry.emoji);
    if (emoji && !out.some((known) => sameEmoji(known, emoji))) out.push(emoji);
  }
  return out;
}

export function stickyRoles(
  config: RolesConfig['sticky'],
  roles: readonly string[],
  guildId: string,
): string[] {
  const ignored = new Set(config.ignoredRoleIds);
  const listed = new Set(config.roleIds);
  return [...new Set(roles)]
    .filter((id) => id !== guildId && !ignored.has(id))
    .filter((id) => config.mode === 'all' || listed.has(id))
    .sort();
}

export function assignable(
  roleIds: readonly string[],
  roles: readonly RoleRef[],
  botRoles: readonly string[] | null,
  guildId: string,
): string[] {
  const byId = new Map(roles.map((role) => [role.id, role]));
  const top = botRoles
    ? Math.max(-1, ...botRoles.map((id) => byId.get(id)?.position ?? -1))
    : Number.POSITIVE_INFINITY;
  return roleIds.filter((id) => {
    const role = byId.get(id);
    return role !== undefined && id !== guildId && !role.managed && role.position < top;
  });
}

export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}
