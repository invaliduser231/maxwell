import type { OverwriteChange, StoredOverwrite } from '@maxwell/core/stores/moderation';
import { namedOverwrite, permissionBits } from '../../platform/permissions.js';
import type {
  ChannelRef,
  Overwrite,
  Permission,
  Platform,
  RawOverwrite,
} from '../../platform/types.js';

export type ChannelState = Omit<ChannelRef, 'overwrites'> & {
  overwrites: Overwrite[];
  raw: RawOverwrite[];
};

const SEND: Permission = 'SendMessages';
const SEND_BIT = BigInt(permissionBits([SEND]));

export function toState(channel: ChannelRef): ChannelState {
  return {
    ...channel,
    overwrites: channel.overwrites.map(namedOverwrite),
    raw: channel.overwrites,
  };
}

export async function channelState(
  platform: Platform,
  guildId: string,
  channelId: string,
): Promise<ChannelState | null> {
  const channels = await platform.channels(guildId).catch(() => [] as ChannelRef[]);
  const channel = channels.find((entry) => entry.id === channelId);
  return channel ? toState(channel) : null;
}

function bitsOf(value: string): bigint {
  try {
    return BigInt(value || '0');
  } catch {
    return 1n;
  }
}

export function onlySend(raw: RawOverwrite | null | undefined): boolean {
  if (!raw) return true;
  return (bitsOf(raw.allow) & ~SEND_BIT) === 0n && (bitsOf(raw.deny) & ~SEND_BIT) === 0n;
}

export function store(overwrite: Overwrite): StoredOverwrite {
  return {
    id: overwrite.id,
    type: overwrite.type,
    allow: [...overwrite.allow],
    deny: [...overwrite.deny],
  };
}

export function toOverwrite(stored: StoredOverwrite): Overwrite {
  return {
    id: stored.id,
    type: stored.type,
    allow: stored.allow as Permission[],
    deny: stored.deny as Permission[],
  };
}

function without(list: readonly string[], value: string): string[] {
  return list.filter((entry) => entry !== value);
}

function withValue(list: readonly string[], value: string): string[] {
  return list.includes(value) ? [...list] : [...list, value];
}

export interface Keeper {
  id: string;
  type: 'role' | 'member';
}

export function lockPlan(
  overwrites: readonly Overwrite[],
  everyoneId: string,
  keepers: readonly Keeper[],
): OverwriteChange[] | 'already' {
  const find = (id: string) => overwrites.find((entry) => entry.id === id) ?? null;
  const everyone = find(everyoneId);
  if (everyone?.deny.includes(SEND)) return 'already';

  const changes: OverwriteChange[] = [];
  const before = everyone ? store(everyone) : null;
  changes.push({
    id: everyoneId,
    type: 'role',
    before,
    after: {
      id: everyoneId,
      type: 'role',
      allow: without(before?.allow ?? [], SEND),
      deny: withValue(before?.deny ?? [], SEND),
    },
  });

  for (const keeper of keepers) {
    if (keeper.id === everyoneId) continue;
    const current = find(keeper.id);
    if (current?.allow.includes(SEND)) continue;
    const prior = current ? store(current) : null;
    changes.push({
      id: keeper.id,
      type: keeper.type,
      before: prior,
      after: {
        id: keeper.id,
        type: keeper.type,
        allow: withValue(prior?.allow ?? [], SEND),
        deny: without(prior?.deny ?? [], SEND),
      },
    });
  }
  return changes;
}

export function revertSend(current: Overwrite | null, change: OverwriteChange): StoredOverwrite {
  const base = current ? store(current) : { id: change.id, type: change.type, allow: [], deny: [] };
  const allowed = change.before?.allow.includes(SEND) ?? false;
  const denied = change.before?.deny.includes(SEND) ?? false;
  return {
    ...base,
    allow: allowed ? withValue(base.allow, SEND) : without(base.allow, SEND),
    deny: denied ? withValue(base.deny, SEND) : without(base.deny, SEND),
  };
}

export function unlockPlan(
  overwrites: readonly Overwrite[],
  everyoneId: string,
): OverwriteChange | 'notLocked' {
  const everyone = overwrites.find((entry) => entry.id === everyoneId) ?? null;
  if (!everyone?.deny.includes(SEND)) return 'notLocked';
  const before = store(everyone);
  return {
    id: everyoneId,
    type: 'role',
    before,
    after: { ...before, deny: without(before.deny, SEND) },
  };
}

export function isLocked(overwrites: readonly Overwrite[], everyoneId: string): boolean {
  return overwrites.some((entry) => entry.id === everyoneId && entry.deny.includes(SEND));
}
