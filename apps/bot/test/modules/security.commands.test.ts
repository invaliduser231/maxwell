import type { SecurityStore } from '@maxwell/core/stores/security';
import { describe, expect, it } from 'vitest';
import type { GuildContext } from '../../src/commands/types.js';
import { securityCommands } from '../../src/modules/security/commands.js';
import type { Ctx } from '../../src/modules/security/guard.js';
import type { Honeypot } from '../../src/modules/security/honeypot.js';
import type { RaidWatch } from '../../src/modules/security/raid.js';
import type { Verifier } from '../../src/modules/security/verification.js';

function setup(ended: boolean) {
  const replies: unknown[] = [];
  const raid = { end: async () => ended } as unknown as RaidWatch;
  const commands = securityCommands(
    {} as Ctx,
    {} as SecurityStore,
    {} as Verifier,
    raid,
    {} as Honeypot,
  );
  const parent = commands.find((command) => command.name === 'security');
  const cmd = {
    guildId: '900000000000000001',
    seed: 1,
    message: { author: { id: '300000000000000001' } },
    services: { voice: { done: (text: string) => `done:${text}` } },
    reply: async (message: unknown) => {
      replies.push(message);
      return '1';
    },
  } as unknown as GuildContext;
  return { parent, cmd, replies };
}

describe('security commands', () => {
  it('shows the status for the bare command with the same permission', () => {
    const { parent } = setup(true);
    const status = parent?.subcommands?.find((command) => command.name === 'status');
    expect(parent?.run).toBe(status?.run);
    expect(parent?.permissions).toEqual(status?.permissions);
  });

  it('confirms when raid mode is turned off', async () => {
    const { parent, cmd, replies } = setup(true);
    const calm = parent?.subcommands?.find((command) => command.name === 'calm');
    await calm?.run?.(cmd);
    expect(String(replies[0])).toContain('Raid mode is off');
  });

  it('says so when raid mode was not on', async () => {
    const { parent, cmd, replies } = setup(false);
    const calm = parent?.subcommands?.find((command) => command.name === 'calm');
    await calm?.run?.(cmd);
    expect(replies[0]).toMatchObject({ content: 'Raid mode is not on.' });
  });
});
