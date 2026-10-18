import { usageLine } from '../../commands/dispatcher.js';
import type { Command, GuildContext } from '../../commands/types.js';
import { lines } from '../../ui/format.js';
import { chunk } from '../../ui/paginator.js';
import { palette } from '../../ui/palette.js';
import { eventsConfig, guildTimezone, MODULE } from './config.js';
import { copy } from './copy.js';
import type { EventService } from './events.js';
import { parseEventDraft, parsePollDraft } from './parse.js';
import type { PollService } from './polls.js';

const PAGE_SIZE = 10;
const POLL_MAX_MS = 30 * 86_400_000;

async function usage(ctx: GuildContext, command: Command, problem: string): Promise<void> {
  await ctx.reply({
    content: ctx.services.voice.usage(problem, usageLine(ctx.prefix, ctx.path, command)),
    deleteAfter: 30_000,
  });
}

export function eventCommands(events: EventService, polls: PollService): Command[] {
  const create: Command = {
    name: 'create',
    aliases: ['new', 'add'],
    description: copy.commands.create,
    guildOnly: true,
    permissions: ['ManageMessages'],
    cooldown: 5_000,
    args: [{ name: 'when and title', type: 'text' }],
    examples: [
      'event create fri 20:00 Movie night',
      'event create weekly mon 19:30 Game night | Bring snacks',
      'event create 2026-11-02 18:00 Launch party',
    ],
    async run(ctx) {
      const { services } = ctx;
      const config = await services.settings.config(ctx.guildId, MODULE, eventsConfig);
      const timezone = await guildTimezone(services, ctx.guildId, config);
      const parsed = parseEventDraft(ctx.args.string('when and title') ?? '', timezone, Date.now());
      if (!parsed.ok) {
        await usage(ctx, create, copy.when[parsed.problem]);
        return;
      }

      const channelId = config.channelId ?? ctx.message.channelId;
      const missing = await events.missingIn(ctx.guildId, channelId);
      if (missing === null) {
        await ctx.reply(copy.noChannel);
        return;
      }
      if (missing.length) {
        await ctx.reply(services.voice.botMissingPermissions(missing, 'there'));
        return;
      }

      const { draft } = parsed;
      const row = await events.create(
        {
          guildId: ctx.guildId,
          title: draft.title,
          description: draft.description,
          startsAt: new Date(draft.startsAt),
          timezone,
          recurrence: draft.recurrence,
          channelId,
          createdBy: ctx.message.author.id,
        },
        { id: ctx.message.author.id },
      );
      await ctx.reply(
        lines(
          services.voice.done(copy.created(row.title, row.startsAt, channelId), ctx.seed),
          copy.createdHint(ctx.prefix, row.number),
        ),
      );
    },
  };

  const list: Command = {
    name: 'list',
    aliases: ['upcoming'],
    description: copy.commands.list,
    guildOnly: true,
    cooldown: 3_000,
    args: [{ name: 'page', type: 'integer', min: 1, max: 10, optional: true }],
    examples: ['event list'],
    async run(ctx) {
      const { voice, pages } = ctx.services;
      const rows = await events.store.upcoming(ctx.guildId, PAGE_SIZE * 10);
      if (rows.length === 0) {
        await ctx.reply(
          lines(voice.empty('events.list', copy.listEmpty, ctx.seed), copy.listHint(ctx.prefix)),
        );
        return;
      }
      const counts = await events.store.rsvpCountsFor(rows);
      const embeds = chunk(rows, PAGE_SIZE).map((group) => ({
        color: palette.north,
        title: copy.listTitle,
        description: lines(
          ...group.map((row) =>
            copy.listLine(row.number, row.title, row.startsAt, counts.get(row.id)?.going ?? 0),
          ),
        ),
      }));
      await pages.send(ctx, embeds, (ctx.args.number('page') ?? 1) - 1);
    },
  };

  const cancelEvent: Command = {
    name: 'cancel',
    aliases: ['delete'],
    description: copy.commands.cancel,
    guildOnly: true,
    permissions: ['ManageMessages'],
    args: [{ name: 'number', type: 'integer', min: 1 }],
    examples: ['event cancel 12'],
    async run(ctx) {
      const number = ctx.args.number('number') ?? 0;
      const row = await events.store.byNumber(ctx.guildId, number);
      if (!row) {
        await ctx.reply(copy.notFound(number));
        return;
      }
      if (row.status !== 'scheduled') {
        await ctx.reply(copy.alreadyOver(number, row.status));
        return;
      }
      await events.cancel(ctx.guildId, row.id, { id: ctx.message.author.id });
      await ctx.reply(ctx.services.voice.done(copy.cancelled(row.title), ctx.seed));
    },
  };

  const event: Command = {
    name: 'event',
    aliases: ['events'],
    description: copy.commands.event,
    guildOnly: true,
    subcommands: [create, list, cancelEvent],
    examples: ['event', 'event create fri 20:00 Movie night', 'event cancel 12'],
    async run(ctx) {
      await list.run?.(ctx);
    },
  };

  const poll: Command = {
    name: 'poll',
    description: copy.commands.poll,
    guildOnly: true,
    permissions: ['ManageMessages'],
    botPermissions: ['EmbedLinks', 'AddReactions'],
    cooldown: 5_000,
    args: [{ name: 'question', type: 'text' }],
    examples: [
      'poll Pizza tonight?',
      'poll 2h What do we play? | Chess | Go | Poker',
      'poll anon multi 1d "Which days work?" "Fri" "Sat" "Sun"',
    ],
    async run(ctx) {
      const { services } = ctx;
      const parsed = parsePollDraft(ctx.args.string('question') ?? '', [
        copy.poll.yes,
        copy.poll.no,
      ]);
      if (!parsed.ok) {
        await usage(ctx, poll, copy.poll.problems[parsed.problem]);
        return;
      }
      const { draft } = parsed;
      if (draft.durationMs !== null && draft.durationMs > POLL_MAX_MS) {
        await usage(ctx, poll, copy.poll.tooLong);
        return;
      }
      const config = await services.settings.config(ctx.guildId, MODULE, eventsConfig);
      const fallbackMs = config.pollDurationMinutes * 60_000;
      const duration = draft.durationMs ?? (fallbackMs > 0 ? fallbackMs : null);

      const result = await polls.create(
        {
          guildId: ctx.guildId,
          question: draft.question,
          options: draft.options,
          anonymous: draft.anonymous,
          multiple: draft.multiple,
          endsAt: duration === null ? null : new Date(Date.now() + duration),
          channelId: ctx.message.channelId,
          createdBy: ctx.message.author.id,
        },
        { id: ctx.message.author.id },
      );
      if (result.ok) return;
      if (result.reason === 'permissions' && result.missing) {
        await ctx.reply(services.voice.botMissingPermissions(result.missing, 'here'));
        return;
      }
      await ctx.reply({ content: copy.poll.noChannel, deleteAfter: 15_000 });
    },
  };

  return [event, poll];
}
