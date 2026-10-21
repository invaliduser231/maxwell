import type { GuildContext } from '../../commands/types.js';
import type {
  IncomingMessage,
  MemberRef,
  Permission,
  Platform,
  RoleRef,
} from '../../platform/types.js';
import type { Services } from '../../services.js';
import { MODULE, moderationConfig } from './config.js';
import { copy } from './copy.js';

export function hasModRole(memberRoles: readonly string[], modRoleIds: readonly string[]): boolean {
  return modRoleIds.some((id) => memberRoles.includes(id));
}

export async function modRoleAllow(message: IncomingMessage, services: Services): Promise<boolean> {
  if (!message.guildId) return false;
  const config = await services.settings.config(message.guildId, MODULE, moderationConfig);
  return hasModRole(message.memberRoles, config.modRoleIds);
}

export async function isModerator(
  ctx: GuildContext,
  permissions: readonly Permission[],
): Promise<boolean> {
  if (await modRoleAllow(ctx.message, ctx.services)) return true;
  return ctx.platform.hasPermissions(
    ctx.guildId,
    ctx.message.author.id,
    ctx.message.channelId,
    permissions,
  );
}

export async function authorize(
  ctx: GuildContext,
  permissions: readonly Permission[],
): Promise<boolean> {
  if (await isModerator(ctx, permissions)) return true;
  await ctx.reply(ctx.services.voice.missingPermissions(permissions));
  return false;
}

export function topPosition(
  member: Pick<MemberRef, 'roles'> | null,
  roles: readonly RoleRef[],
): number {
  if (!member) return 0;
  let top = 0;
  for (const role of roles) {
    if (member.roles.includes(role.id) && role.position > top) top = role.position;
  }
  return top;
}

export type TargetProblem = 'self' | 'me' | 'notMember' | 'admin' | 'higher' | 'botLower';

export interface TargetCheck {
  guildId: string;
  actorId: string;
  targetId: string;
  needsMember: boolean;
  botAction: boolean;
}

export async function checkTarget(
  platform: Platform,
  input: TargetCheck,
): Promise<{ problem: TargetProblem | null; member: MemberRef | null }> {
  const { guildId, actorId, targetId } = input;
  if (targetId === actorId) return { problem: 'self', member: null };
  if (targetId === platform.selfId) return { problem: 'me', member: null };

  const member = await platform.member(guildId, targetId);
  if (!member) return { problem: input.needsMember ? 'notMember' : null, member: null };

  const [roles, actor, actorAdmin, targetAdmin] = await Promise.all([
    platform.roles(guildId).catch(() => [] as RoleRef[]),
    platform.member(guildId, actorId),
    platform.hasPermissions(guildId, actorId, null, ['Administrator']).catch(() => false),
    platform.hasPermissions(guildId, targetId, null, ['Administrator']).catch(() => false),
  ]);
  const target = topPosition(member, roles);
  if (!actorAdmin) {
    if (targetAdmin) return { problem: 'admin', member };
    if (target > 0 && target >= topPosition(actor, roles)) return { problem: 'higher', member };
  }
  if (input.botAction && platform.selfId) {
    const me = await platform.member(guildId, platform.selfId);
    if (me && target >= topPosition(me, roles) && target > 0)
      return { problem: 'botLower', member };
  }
  return { problem: null, member };
}

export function describeProblem(problem: TargetProblem, who: string): string {
  switch (problem) {
    case 'self':
      return copy.errors.self;
    case 'me':
      return copy.errors.me;
    case 'notMember':
      return copy.errors.notMember(who);
    case 'admin':
      return copy.errors.admin(who);
    case 'higher':
      return copy.errors.higher(who);
    case 'botLower':
      return copy.errors.botLower(who);
  }
}

export function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const record = error as { statusCode?: unknown; status?: unknown };
  if (typeof record.statusCode === 'number') return record.statusCode;
  if (typeof record.status === 'number') return record.status;
  return null;
}
