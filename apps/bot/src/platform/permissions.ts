import { PermissionFlags } from '@fluxerjs/core';
import { type Permission, permissions, type RawOverwrite } from './types.js';

export function permissionNames(bits: string): Permission[] {
  let value: bigint;
  try {
    value = BigInt(bits);
  } catch {
    return [];
  }
  return permissions.filter((name) => (value & PermissionFlags[name]) !== 0n);
}

export function permissionBits(names: readonly Permission[]): string {
  return names.reduce((acc, name) => acc | PermissionFlags[name], 0n).toString();
}

export function namedOverwrite(raw: RawOverwrite): {
  id: string;
  type: 'role' | 'member';
  allow: Permission[];
  deny: Permission[];
} {
  return {
    id: raw.id,
    type: raw.type,
    allow: permissionNames(raw.allow),
    deny: permissionNames(raw.deny),
  };
}
