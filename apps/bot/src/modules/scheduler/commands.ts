import type { Command } from '../../commands/types.js';
import { lines, truncate } from '../../ui/format.js';
import { chunk } from '../../ui/paginator.js';
import { palette } from '../../ui/palette.js';
import { MODULE, schedulerConfig } from './config.js';
import { copy } from './copy.js';
import { checkReminder, type Reminders } from './reminders.js';

const PAGE_SIZE = 10;

export function schedulerCommands(reminders: Reminders): Command[] {
  const remind: Command = {
    name: 'remind',
    aliases: ['reminder', 'remindme'],
    description: copy.commands.remind,
    guildOnly: true,
    cooldown: 3_000,
    args: [
      { name: 'duration', type: 'duration' },
      { name: 'text', type: 'text' },
    ],
    examples: ['remind 2h stretch your legs', 'remind 1d30m check the oven'],
    async run(ctx) {
      const { voice, settings } = ctx.services;
      const delay = ctx.args.number('duration') ?? 0;
      const text = ctx.args.string('text') ?? '';
      const userId = ctx.message.author.id;
      const config = await settings.config(ctx.guildId, MODULE, schedulerConfig);
      const existing = await reminders.store.countForMember(ctx.guildId, userId);
      const check = checkReminder(config, delay, existing);
      if (!check.ok) {
        const message =
          check.reason === 'off'
            ? copy.remindersOff
            : check.reason === 'far'
              ? copy.tooFar(check.limit)
              : copy.tooMany(check.limit, ctx.prefix);
        await ctx.reply({ content: message, deleteAfter: 30_000 });
        return;
      }
      const row = await reminders.create({
        guildId: ctx.guildId,
        channelId: ctx.message.channelId,
        userId,
        content: text,
        dueAt: new Date(Date.now() + delay),
      });
      const messageId = await ctx.reply(
        lines(voice.done(copy.set(row.dueAt), ctx.seed), copy.setHint(ctx.prefix, row.number)),
      );
      await reminders.offerCancel(ctx.message.channelId, messageId, row);
    },
  };

  const cancelReminder: Command = {
    name: 'cancel',
    aliases: ['delete', 'remove'],
    description: copy.commands.cancel,
    guildOnly: true,
    args: [{ name: 'number', type: 'integer', min: 1 }],
    examples: ['reminders cancel 12'],
    async run(ctx) {
      const number = ctx.args.number('number') ?? 0;
      const userId = ctx.message.author.id;
      const found = await reminders.store.byNumber(ctx.guildId, number);
      const row =
        found?.userId === userId ? await reminders.cancel(ctx.guildId, found.id, userId) : null;
      if (!row) {
        await ctx.reply(copy.notFound(number));
        return;
      }
      await ctx.reply(ctx.services.voice.done(copy.cancelled(row.number), ctx.seed));
    },
  };

  const list: Command = {
    name: 'reminders',
    description: copy.commands.reminders,
    guildOnly: true,
    cooldown: 3_000,
    args: [{ name: 'page', type: 'integer', min: 1, max: 20, optional: true }],
    examples: ['reminders', 'reminders cancel 12'],
    subcommands: [cancelReminder],
    async run(ctx) {
      const { voice, pages } = ctx.services;
      const rows = await reminders.store.forMember(ctx.guildId, ctx.message.author.id);
      if (rows.length === 0) {
        await ctx.reply(
          lines(
            voice.empty('scheduler.reminders', copy.empty, ctx.seed),
            copy.emptyHint(ctx.prefix),
          ),
        );
        return;
      }
      const embeds = chunk(rows, PAGE_SIZE).map((group) => ({
        color: palette.south,
        title: copy.listTitle,
        description: lines(
          ...group.map((row) =>
            copy.listLine(row.number, row.dueAt, truncate(row.content.replace(/\s+/g, ' '), 80)),
          ),
          '',
          copy.listFooter(ctx.prefix),
        ),
      }));
      await pages.send(ctx, embeds, (ctx.args.number('page') ?? 1) - 1);
    },
  };

  return [remind, list];
}
