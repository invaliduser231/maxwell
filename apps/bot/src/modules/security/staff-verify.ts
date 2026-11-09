import { userId as parseUserId } from '../../commands/mentions.js';
import type { Services } from '../../services.js';
import { ticketServiceFor } from '../tickets/service.js';
import { audit, copy } from './copy.js';
import type { Ctx } from './guard.js';
import type { Verifier } from './verification.js';

export interface StaffVerifyInput {
  guildId: string;
  channelId: string;
  authorId: string;
  text: string | null;
}

async function inTicket(services: Services, input: StaffVerifyInput) {
  const tickets = ticketServiceFor(services);
  if (!tickets) return null;
  const ticket = await tickets.ticketForChannel(input.channelId);
  if (ticket?.status !== 'open' || ticket.source === 'modmail') return null;
  const config = await tickets.ctx.config(input.guildId);
  const panel = config.panels.find((entry) => entry.id === ticket.panelId);
  const team =
    (await tickets.isTeam(input.guildId, input.authorId, ticket.panelId)) ||
    (await services.platform
      .hasPermissions(input.guildId, input.authorId, null, ['ManageRoles'])
      .catch(() => false));
  return { ticket, roleId: panel?.verifyRoleId ?? null, team };
}

export async function staffVerify(
  ctx: Ctx,
  verifier: Verifier,
  input: StaffVerifyInput,
): Promise<string | null> {
  const { services } = ctx;
  const { platform } = services;
  const mentioned = input.text ? parseUserId(input.text) : null;
  if (input.text && !mentioned) return null;

  const ticket = await inTicket(services, input);
  if (ticket && !ticket.team) return null;
  if (!ticket) {
    if (!mentioned) return null;
    const allowed = await platform
      .hasPermissions(input.guildId, input.authorId, null, ['ModerateMembers'])
      .catch(() => false);
    if (!allowed) return null;
  }

  const target = mentioned ?? ticket?.ticket.openerId;
  if (!target || target === input.authorId) return null;

  const roleId = ticket?.roleId ?? null;
  if (roleId) {
    try {
      await platform.addRole(input.guildId, target, roleId, audit.verified(target, null));
    } catch {
      return copy.staffVerify.roleFailed(target, roleId);
    }
  }
  const passed = await verifier.pass(input.guildId, target, input.authorId);
  if (!roleId && !passed) return copy.staffVerify.nothing(target);

  const member = await platform.member(input.guildId, target).catch(() => null);
  const name = member?.user.displayName ?? target;
  const roleName = roleId
    ? ((await platform.roles(input.guildId).catch(() => [])).find((role) => role.id === roleId)
        ?.name ?? roleId)
    : null;
  await ctx.record(
    input.guildId,
    { id: input.authorId },
    'verify',
    audit.verified(name, roleName),
    {
      after: { userId: target, roleId },
    },
  );
  return roleId ? copy.staffVerify.doneRole(target, roleId) : copy.staffVerify.done(target);
}

export async function isStaff(ctx: Ctx, guildId: string, userId: string): Promise<boolean> {
  return ctx.services.platform
    .hasPermissions(guildId, userId, null, ['ModerateMembers'])
    .catch(() => false);
}
