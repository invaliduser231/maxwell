import { ticketsConfig } from '@maxwell/core/modules/tickets';
import { describe, expect, it } from 'vitest';
import type { Ctx } from '../../src/modules/security/guard.js';
import { staffVerify } from '../../src/modules/security/staff-verify.js';
import type { Verifier } from '../../src/modules/security/verification.js';
import { TicketService, type TicketsContext } from '../../src/modules/tickets/service.js';

const guild = '100000000000000001';
const ticketChannel = '700000000000000001';
const otherChannel = '700000000000000002';
const opener = '300000000000000001';
const staff = '300000000000000002';
const member = '300000000000000003';
const role = '500000000000000001';

interface Options {
  roleId?: string | null;
  team?: string[];
  moderators?: string[];
  pending?: string[];
  roleFails?: boolean;
}

function setup(options: Options = {}) {
  const added: [string, string][] = [];
  const passed: string[] = [];
  const recorded: string[] = [];
  const team = options.team ?? [staff];
  const moderators = options.moderators ?? [staff];
  const platform = {
    hasPermissions: async (_guild: string, userId: string, _channel: null, perms: string[]) =>
      perms.includes('ModerateMembers') && moderators.includes(userId),
    addRole: async (_guild: string, userId: string, roleId: string) => {
      if (options.roleFails) throw new Error('missing access');
      added.push([userId, roleId]);
    },
    member: async (_guild: string, userId: string) => ({ user: { displayName: `name-${userId}` } }),
    roles: async () => [{ id: role, name: 'Verificado' }],
  };
  const services = { sql: {}, platform };
  const config = ticketsConfig.parse({
    panels: [{ id: 'verify', name: 'Verificación', verifyRoleId: options.roleId ?? null }],
  });
  const tickets = new TicketService({
    services,
    config: async () => config,
  } as unknown as TicketsContext);
  tickets.ticketForChannel = async (channelId: string) =>
    channelId === ticketChannel
      ? ({
          guildId: guild,
          panelId: 'verify',
          status: 'open',
          source: 'panel',
          openerId: opener,
        } as never)
      : null;
  tickets.isTeam = async (_guild: string, userId: string) => team.includes(userId);
  const ctx = {
    services,
    record: async (_guild: string, _by: unknown, _action: string, summary: string) => {
      recorded.push(summary);
    },
  } as unknown as Ctx;
  const verifier = {
    pass: async (_guild: string, userId: string) => {
      const waiting = (options.pending ?? []).includes(userId);
      if (waiting) passed.push(userId);
      return waiting;
    },
  } as unknown as Verifier;
  const run = (authorId: string, channelId: string, text: string | null = null) =>
    staffVerify(ctx, verifier, { guildId: guild, channelId, authorId, text });
  return { run, added, passed, recorded };
}

describe('staff verify', () => {
  it('gives the ticket opener the panel role when the team types verify', async () => {
    const h = setup({ roleId: role });
    expect(await h.run(staff, ticketChannel)).toBe(
      `<@${opener}> is verified and has <@&${role}> now.`,
    );
    expect(h.added).toEqual([[opener, role]]);
    expect(h.recorded).toEqual([`Verified name-${opener} and gave Verificado`]);
  });

  it('leaves the opener to their own captcha', async () => {
    const h = setup({ roleId: role });
    expect(await h.run(opener, ticketChannel)).toBeNull();
    expect(h.added).toEqual([]);
  });

  it('verifies a mentioned member outside a ticket through the security check', async () => {
    const h = setup({ pending: [member] });
    expect(await h.run(staff, otherChannel, `<@${member}>`)).toBe(`<@${member}> is verified.`);
    expect(h.passed).toEqual([member]);
  });

  it('ignores mentions from members without Moderate Members', async () => {
    const h = setup({ pending: [member] });
    expect(await h.run(opener, otherChannel, `<@${member}>`)).toBeNull();
    expect(h.passed).toEqual([]);
  });

  it('says what is missing when there is no role and no check', async () => {
    const h = setup();
    expect(await h.run(staff, ticketChannel)).toContain('this ticket panel gives no role');
    expect(h.recorded).toEqual([]);
  });

  it('reports when the role cannot be given', async () => {
    const h = setup({ roleId: role, roleFails: true });
    expect(await h.run(staff, ticketChannel)).toContain("I couldn't give");
    expect(h.recorded).toEqual([]);
  });

  it('keeps captcha codes working in a ticket', async () => {
    const h = setup({ roleId: role });
    expect(await h.run(staff, ticketChannel, '12345')).toBeNull();
    expect(h.added).toEqual([]);
  });
});
