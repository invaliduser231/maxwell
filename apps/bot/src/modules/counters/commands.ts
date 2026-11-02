import {
  COUNTER_LIMIT,
  type Counter,
  type CounterType,
  type countersConfig,
  counterTypes,
} from '@maxwell/core/modules/counters';
import type { Command } from '../../commands/types.js';
import { ChannelKind } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { code, lines } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import type { CounterBoard } from './board.js';
import { copy, reasons } from './copy.js';

function isType(value: string | undefined): value is CounterType {
  return (counterTypes as readonly string[]).includes(value ?? '');
}

export function counterInput(
  type: CounterType,
  value: string | undefined,
): Omit<Counter, 'channelId' | 'template'> | 'goal' | 'date' {
  if (type === 'goal') {
    const goal = Number(value);
    return Number.isInteger(goal) && goal >= 1 && goal <= 100_000_000
      ? { type, goal, until: null }
      : 'goal';
  }
  if (type === 'countdown') {
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
      ? { type, goal: null, until: value }
      : 'date';
  }
  return { type, goal: null, until: null };
}

export function counterCommand(
  ctx: ModuleContext<typeof countersConfig>,
  board: CounterBoard,
): Command {
  const add: Command = {
    name: 'add',
    description: copy.commands.add,
    guildOnly: true,
    permissions: ['ManageGuild'],
    botPermissions: ['ManageChannels'],
    cooldown: 10_000,
    args: [
      { name: 'type', type: 'word' },
      { name: 'value', type: 'word', optional: true },
    ],
    examples: ['counter add members', 'counter add goal 1000', 'counter add countdown 2027-01-01'],
    async run(command) {
      const type = command.args.string('type')?.toLowerCase();
      if (!isType(type)) {
        await command.reply(copy.unknownType(counterTypes.map((entry) => code(entry)).join(', ')));
        return;
      }
      const input = counterInput(type, command.args.string('value'));
      if (input === 'goal') {
        await command.reply(copy.needsGoal(command.prefix));
        return;
      }
      if (input === 'date') {
        await command.reply(copy.needsDate(command.prefix));
        return;
      }
      const config = await ctx.config(command.guildId);
      if (config.counters.length >= COUNTER_LIMIT) {
        await command.reply(copy.full(COUNTER_LIMIT));
        return;
      }
      const template = copy.templates[type];
      let channelId: string;
      try {
        channelId = await command.platform.createChannel(
          command.guildId,
          {
            name: copy.types[type],
            type: ChannelKind.Voice,
            overwrites: [{ id: command.guildId, type: 'role', allow: [], deny: ['Connect'] }],
          },
          reasons.create,
        );
      } catch (error) {
        command.services.log.warn({ err: error, guild: command.guildId }, 'counter channel failed');
        await command.reply(copy.failed);
        return;
      }
      await board.add(
        command.guildId,
        { ...input, channelId, template },
        command.message.author.id,
      );
      await board.refresh(command.guildId).catch(() => 0);
      await command.reply(copy.created(channelId));
    },
  };

  const list: Command = {
    name: 'list',
    description: copy.commands.list,
    guildOnly: true,
    permissions: ['ManageGuild'],
    async run(command) {
      const { counters } = await ctx.config(command.guildId);
      if (counters.length === 0) {
        await command.reply(
          command.services.voice.empty('counters.list', copy.empty(command.prefix), command.seed),
        );
        return;
      }
      await command.reply({
        embeds: [
          {
            color: palette.north,
            title: copy.listTitle,
            description: lines(
              ...counters.map((item) => copy.listLine(item.channelId, copy.types[item.type])),
            ),
          },
        ],
      });
    },
  };

  return {
    name: 'counter',
    aliases: ['counters'],
    description: copy.commands.counter,
    guildOnly: true,
    subcommands: [add, list],
  };
}
