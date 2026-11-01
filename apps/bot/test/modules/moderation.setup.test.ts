import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/commands/types.js';
import logs from '../../src/modules/logs/index.js';
import moderation from '../../src/modules/moderation/index.js';
import type { BotModule, ModuleContext } from '../../src/runtime/module.js';
import type { PrivacyHandler } from '../../src/runtime/privacy.js';
import type { Services } from '../../src/services.js';

function fakeContext(module: BotModule) {
  const jobs: string[] = [];
  const undos: string[] = [];
  const events: string[] = [];
  const privacy: PrivacyHandler[] = [];
  const ctx = {
    key: module.definition.key,
    definition: module.definition,
    services: { sql: {} } as unknown as Services,
    config: async () => module.definition.config.parse({}),
    enabled: async () => true,
    update: async () => {},
    on: (event: string) => {
      events.push(event);
    },
    job: (kind: string) => {
      if (jobs.includes(kind)) throw new Error(`duplicate job ${kind}`);
      jobs.push(kind);
    },
    schedule: async () => null,
    undo: (kind: string) => {
      if (undos.includes(kind)) throw new Error(`duplicate undo ${kind}`);
      undos.push(kind);
    },
    onShutdown: () => {},
    privacy: (handler: PrivacyHandler) => {
      privacy.push(handler);
    },
    record: async () => '1',
  } as unknown as ModuleContext;
  return { ctx, jobs, undos, events, privacy };
}

function names(commands: Command[]): string[] {
  return commands.flatMap((command) => [command.name, ...(command.aliases ?? [])]).sort();
}

describe('module setup', () => {
  it('registers the moderation commands, jobs and undo handlers', async () => {
    const { ctx, jobs, undos, events, privacy } = fakeContext(moderation as BotModule);
    const commands = ((await moderation.setup?.(ctx as never)) ?? []) as Command[];
    expect(names(commands)).toEqual(
      [
        'ban',
        'case',
        'cases',
        'kick',
        'lock',
        'massban',
        'note',
        'notes',
        'purge',
        'reason',
        'report',
        'slowmode',
        'timeout',
        'unban',
        'unlock',
        'untimeout',
        'warn',
        'warnings',
      ].sort(),
    );
    expect(commands.every((command) => command.guildOnly === true)).toBe(true);
    const leaves = commands.flatMap((command) => [command, ...(command.subcommands ?? [])]);
    for (const command of leaves.filter((entry) => !['warnings', 'report'].includes(entry.name))) {
      expect(command.permissions?.length, command.name).toBeGreaterThan(0);
      expect(typeof command.allow, command.name).toBe('function');
    }
    expect(jobs.sort()).toEqual(
      [
        'action',
        'expire',
        'inbox.assign',
        'inbox.notify',
        'inbox.resolve',
        'massban',
        'retention',
        'review',
        'sweep',
        'sync',
        'unlock',
      ].sort(),
    );
    expect(undos).toEqual(
      expect.arrayContaining([
        'ban',
        'timeout',
        'warn',
        'unban',
        'lock',
        'unlock',
        'slowmode',
        'inbox',
      ]),
    );
    expect(events).toEqual(
      expect.arrayContaining(['banAdd', 'banRemove', 'memberUpdate', 'auditLog']),
    );
    expect(privacy).toHaveLength(1);
    expect(typeof privacy[0]?.export).toBe('function');
    expect(typeof privacy[0]?.forget).toBe('function');
  });

  it('wires every log event and the test job', async () => {
    const { ctx, jobs, events, privacy } = fakeContext(logs as BotModule);
    const commands = (await logs.setup?.(ctx as never)) ?? [];
    expect(commands).toEqual([]);
    expect(jobs).toEqual(['test']);
    expect(events).toEqual(
      expect.arrayContaining([
        'message',
        'messageEdit',
        'messageRemove',
        'messageBulkRemove',
        'memberJoin',
        'memberLeave',
        'memberUpdate',
        'roleUpdate',
        'channelUpdate',
        'voiceUpdate',
        'inviteCreate',
        'banAdd',
        'auditLog',
      ]),
    );
    expect(privacy).toHaveLength(1);
    expect(privacy[0]?.export).toBeUndefined();
  });
});
