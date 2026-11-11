import type { giveawaysConfig } from '@maxwell/core/modules/giveaways';
import type { Giveaway, GiveawayStore } from '@maxwell/core/stores/giveaways';
import type { Command, GuildContext } from '../../commands/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { lines } from '../../ui/format.js';
import { chunk } from '../../ui/paginator.js';
import { palette } from '../../ui/palette.js';
import { audit, copy } from './copy.js';
import { parseStartOptions } from './options.js';
import { type GiveawayRunner, MAX_DURATION, MIN_DURATION } from './runner.js';

type Context = ModuleContext<typeof giveawaysConfig>;

const NOISE = 15_000;

function actor(ctx: GuildContext) {
  return { id: ctx.message.author.id };
}

async function find(
  ctx: GuildContext,
  store: GiveawayStore,
  status: 'running' | 'ended',
): Promise<Giveaway | null> {
  const number = ctx.args.number('number');
  if (number === undefined) {
    const latest = await store.latest(ctx.guildId, status);
    if (!latest) {
      await ctx.reply({
        content: status === 'running' ? copy.noneRunning : copy.noneEnded,
        deleteAfter: NOISE,
      });
    }
    return latest;
  }
  const giveaway = await store.byNumber(ctx.guildId, number);
  if (!giveaway) {
    await ctx.reply({ content: copy.notFound(number), deleteAfter: NOISE });
    return null;
  }
  if (giveaway.status !== status) {
    await ctx.reply({
      content:
        status === 'running' ? copy.notRunning(giveaway.number) : copy.notEnded(giveaway.number),
      deleteAfter: NOISE,
    });
    return null;
  }
  return giveaway;
}

export function giveawayCommands(
  module: Context,
  store: GiveawayStore,
  runner: GiveawayRunner,
): Command[] {
  const start: Command = {
    name: 'start',
    description: copy.startDescription,
    guildOnly: true,
    permissions: ['ManageGuild'],
    args: [
      { name: 'channel', type: 'channel', optional: true },
      { name: 'duration', type: 'duration' },
      { name: 'winners', type: 'integer', min: 1, max: 50 },
      { name: 'prize', type: 'text' },
    ],
    examples: [
      'giveaway start 2d 1 Steam key for Hades',
      'giveaway start #events 1d12h30m 3 Art commission --role @Members --level 5',
      'giveaway start 45m 2 Nitro --not @Muted --days 30 --ping @Giveaways --nodm',
    ],
    async run(ctx) {
      const { voice, platform } = ctx.services;
      const duration = ctx.args.number('duration') as number;
      const parsed = parseStartOptions(ctx.args.string('prize') ?? '');
      if (!parsed.ok) {
        await ctx.reply({ content: copy.badOption(parsed.flag), deleteAfter: NOISE });
        return;
      }
      const prize = parsed.prize.trim();
      if (duration < MIN_DURATION || duration > MAX_DURATION) {
        await ctx.reply({
          content: duration < MIN_DURATION ? copy.tooShort : copy.tooLong,
          deleteAfter: NOISE,
        });
        return;
      }
      if (prize.length === 0 || prize.length > 256) {
        await ctx.reply({ content: copy.prizeTooLong, deleteAfter: NOISE });
        return;
      }

      const channelId = ctx.args.string('channel') ?? ctx.message.channelId;
      if (!(await platform.channelInGuild(ctx.guildId, channelId))) {
        await ctx.reply({ content: copy.channelGone, deleteAfter: NOISE });
        return;
      }
      const missing = await platform.missingBotPermissions(ctx.guildId, channelId, [
        'SendMessages',
        'EmbedLinks',
        'AddReactions',
        'ReadMessageHistory',
      ]);
      if (missing.length > 0) {
        await ctx.reply(voice.botMissingPermissions(missing, copy.inChannel(channelId)));
        return;
      }

      const created = await runner.create(
        ctx.guildId,
        {
          channelId,
          prize,
          winners: ctx.args.number('winners') as number,
          durationSeconds: Math.round(duration / 1000),
          ...parsed.options,
        },
        ctx.message.author.id,
      );
      const giveaway = created ? await runner.launch(created) : null;
      if (!giveaway) {
        await ctx.reply({ content: copy.channelGone, deleteAfter: NOISE });
        return;
      }
      await module.record(ctx.guildId, actor(ctx), 'giveaway.start', audit.start(prize), {
        after: {
          giveawayId: giveaway.id,
          number: giveaway.number,
          prize,
          channelId,
          endsAt: giveaway.endsAt,
        },
        undo: { kind: 'cancel', payload: { giveawayId: giveaway.id } },
      });
      if (channelId !== ctx.message.channelId) {
        await ctx.reply(voice.done(copy.started(giveaway.number, channelId), ctx.seed));
      }
    },
  };

  const end: Command = {
    name: 'end',
    description: copy.endDescription,
    guildOnly: true,
    permissions: ['ManageGuild'],
    args: [{ name: 'number', type: 'integer', min: 1, optional: true }],
    examples: ['giveaway end', 'giveaway end 12'],
    async run(ctx) {
      const giveaway = await find(ctx, store, 'running');
      if (!giveaway) return;
      const ended = await runner.end(giveaway.id);
      if (!ended) {
        await ctx.reply({ content: copy.notRunning(giveaway.number), deleteAfter: NOISE });
        return;
      }
      await module.record(ctx.guildId, actor(ctx), 'giveaway.end', audit.end(giveaway.prize), {
        after: { giveawayId: giveaway.id, number: giveaway.number },
      });
      if (giveaway.channelId !== ctx.message.channelId) {
        await ctx.reply(ctx.services.voice.done(copy.endedNow(giveaway.number), ctx.seed));
      }
    },
  };

  const reroll: Command = {
    name: 'reroll',
    description: copy.rerollDescription,
    guildOnly: true,
    permissions: ['ManageGuild'],
    args: [
      { name: 'number', type: 'integer', min: 1, optional: true },
      { name: 'count', type: 'integer', min: 1, max: 20, optional: true },
    ],
    examples: ['giveaway reroll', 'giveaway reroll 12 2'],
    async run(ctx) {
      const giveaway = await find(ctx, store, 'ended');
      if (!giveaway) return;
      const count = ctx.args.number('count') ?? 1;
      const winners = await runner.reroll(giveaway, count);
      await module.record(
        ctx.guildId,
        actor(ctx),
        'giveaway.reroll',
        audit.reroll(giveaway.prize, winners.length),
        { after: { giveawayId: giveaway.id, number: giveaway.number, winners } },
      );
      if (giveaway.channelId !== ctx.message.channelId) {
        await ctx.reply(
          winners.length > 0
            ? ctx.services.voice.done(copy.rerolledNow(giveaway.number), ctx.seed)
            : copy.nobodyLeft(giveaway.prize),
        );
      }
    },
  };

  const list: Command = {
    name: 'list',
    description: copy.listDescription,
    guildOnly: true,
    cooldown: 5_000,
    examples: ['giveaway list'],
    async run(ctx) {
      const active = await store.active(ctx.guildId);
      if (active.length === 0) {
        await ctx.reply(ctx.services.voice.empty('giveaways.list', copy.emptyList, ctx.seed));
        return;
      }
      const pages = chunk(active, 10).map((group) => ({
        color: palette.north,
        title: copy.listTitle,
        description: lines(
          ...group.map((g) =>
            g.status === 'running'
              ? copy.listRunning(g.number, g.prize, g.channelId, g.endsAt, g.winners)
              : copy.listScheduled(g.number, g.prize, g.channelId, g.startsAt),
          ),
        ),
      }));
      await ctx.services.pages.send(ctx, pages);
    },
  };

  return [
    {
      name: 'giveaway',
      aliases: ['giveaways', 'gw'],
      description: copy.giveawayDescription,
      guildOnly: true,
      subcommands: [start, end, reroll, list],
    },
  ];
}
