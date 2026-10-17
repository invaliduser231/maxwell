import { permissionBits, permissionsFromBits } from '@maxwell/core/modules/backups';
import { permissionBits as platformBits } from '../../platform/permissions.js';
import { type Permission, permissions } from '../../platform/types.js';

const known = new Set<string>(permissions);

export function toPlatformPermissions(bits: string | null | undefined): Permission[] {
  return permissionsFromBits(bits).filter((name): name is Permission => known.has(name));
}

export function droppedPermissions(bits: string | null | undefined): string[] {
  let value: bigint;
  try {
    value = BigInt(bits ?? '0');
  } catch {
    return [];
  }
  const names = new Map<number, string>(
    Object.entries(permissionBits).map(([name, bit]) => [bit, name]),
  );
  const out: string[] = [];
  for (let bit = 0; bit < 64; bit++) {
    if (((value >> BigInt(bit)) & 1n) === 0n) continue;
    const name = names.get(bit) ?? `bit ${bit}`;
    if (!known.has(name)) out.push(name);
  }
  return out;
}

const platformMask = BigInt(platformBits(permissions));

export function withNamedPermissions(current: string, names: readonly Permission[]): string {
  let base: bigint;
  try {
    base = BigInt(current);
  } catch {
    base = 0n;
  }
  return ((base & ~platformMask) | BigInt(platformBits(names))).toString();
}
