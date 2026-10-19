import { type Permission, permissions } from '../../platform/types.js';

const bits: Record<Permission, number> = {
  Administrator: 3,
  ManageGuild: 5,
  ManageChannels: 4,
  ManageRoles: 28,
  ManageMessages: 13,
  ManageNicknames: 27,
  ManageWebhooks: 29,
  KickMembers: 1,
  BanMembers: 2,
  ModerateMembers: 40,
  ViewAuditLog: 7,
  ViewChannel: 10,
  SendMessages: 11,
  ReadMessageHistory: 16,
  EmbedLinks: 14,
  AttachFiles: 15,
  AddReactions: 6,
  MentionEveryone: 17,
  Connect: 20,
  MoveMembers: 24,
};

function parse(value: string): bigint {
  try {
    return BigInt(value || '0');
  } catch {
    return 0n;
  }
}

export function permissionDiff(
  before: string,
  after: string,
): { added: Permission[]; removed: Permission[]; other: boolean } {
  const a = parse(before);
  const b = parse(after);
  const added: Permission[] = [];
  const removed: Permission[] = [];
  let known = 0n;
  for (const name of permissions) {
    const bit = 1n << BigInt(bits[name]);
    known |= bit;
    const had = (a & bit) !== 0n;
    const has = (b & bit) !== 0n;
    if (!had && has) added.push(name);
    if (had && !has) removed.push(name);
  }
  return { added, removed, other: (a & ~known) !== (b & ~known) };
}
