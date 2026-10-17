import { describe, expect, it } from 'vitest';
import { stripPrefix } from '../src/commands/dispatcher.js';
import { commandCatalog, Registry } from '../src/commands/registry.js';
import { tokenize } from '../src/commands/tokenize.js';
import type { Command } from '../src/commands/types.js';

const run = async () => {};

const invites: Command = {
  name: 'invites',
  aliases: ['inv'],
  description: '',
  run,
  subcommands: [
    { name: 'top', aliases: ['lb'], description: '', run },
    { name: 'log', description: '', run },
  ],
};

describe('Registry', () => {
  const registry = new Registry();
  registry.add({ key: 'invites', name: 'Invites', description: '', commands: [invites] });

  it('resolves aliases and subcommands case-insensitively', () => {
    const resolved = registry.resolve(tokenize('INV LB extra'));
    expect(resolved?.path).toEqual(['invites', 'top']);
    expect(resolved?.rest.map((t) => t.value)).toEqual(['extra']);
  });

  it('falls back to the parent when the next word is not a subcommand', () => {
    const resolved = registry.resolve(tokenize('invites <@123456789012345678>'));
    expect(resolved?.path).toEqual(['invites']);
    expect(resolved?.rest).toHaveLength(1);
  });

  it('returns null for unknown commands', () => {
    expect(registry.resolve(tokenize('nope'))).toBeNull();
  });

  it('rejects duplicate names', () => {
    expect(() =>
      registry.add({
        key: 'other',
        name: 'Other',
        description: '',
        commands: [{ ...invites, aliases: [] }],
      }),
    ).toThrow();
  });

  it('finds commands by path', () => {
    expect(registry.find(['invites', 'lb'])?.name).toBe('top');
  });
});

describe('stripPrefix', () => {
  const self = '111111111111111111';

  it('accepts the prefix in any case', () => {
    expect(stripPrefix('M!help me', 'm!', self)).toBe('help me');
  });

  it('accepts a mention of the bot', () => {
    expect(stripPrefix(`<@${self}> help`, 'm!', self)).toBe('help');
    expect(stripPrefix(`<@!${self}>`, 'm!', self)).toBe('');
  });

  it('ignores everything else', () => {
    expect(stripPrefix('hello m!help', 'm!', self)).toBeNull();
    expect(stripPrefix('<@222222222222222222> help', 'm!', self)).toBeNull();
  });
});

describe('commandCatalog', () => {
  it('lists visible commands with their module and subcommands', () => {
    const registry = new Registry();
    registry.add({
      key: 'levels',
      name: 'Levels',
      description: '',
      commands: [
        {
          name: 'xp',
          aliases: ['exp'],
          description: 'XP tools',
          subcommands: [
            { name: 'give', description: '' },
            { name: 'debug', description: '', hidden: true },
          ],
        },
        { name: 'secret', description: '', hidden: true },
      ],
    });
    expect(commandCatalog(registry)).toEqual([
      {
        name: 'xp',
        aliases: ['exp'],
        module: 'levels',
        description: 'XP tools',
        subcommands: ['give'],
      },
    ]);
  });
});
