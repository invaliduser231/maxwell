import type { BackupStore } from '@maxwell/core/stores/backups';
import type { Command } from '../../commands/types.js';
import { lines, subtext, timestamp, truncate } from '../../ui/format.js';
import { chunk } from '../../ui/paginator.js';
import { palette } from '../../ui/palette.js';
import { copy } from './copy.js';
import type { BackupService } from './service.js';

const PAGE_SIZE = 10;

export function backupCommand(store: BackupStore, service: BackupService): Command {
  const now: Command = {
    name: 'now',
    description: copy.commands.now,
    guildOnly: true,
    permissions: ['ManageGuild'],
    cooldown: 60_000,
    args: [{ name: 'label', type: 'text', optional: true }],
    examples: ['backup now', 'backup now before the event'],
    async run(ctx) {
      const { voice, log } = ctx.services;
      const label = ctx.args.string('label');
      try {
        const meta = await service.take(
          ctx.guildId,
          'manual',
          { id: ctx.message.author.id },
          label ? truncate(label, 100) : null,
        );
        await ctx.reply(
          voice.done(copy.saved(meta.number, meta.roleCount, meta.channelCount), ctx.seed),
        );
      } catch (error) {
        log.warn({ err: error, guild: ctx.guildId }, 'manual snapshot failed');
        await ctx.reply(copy.failed);
      }
    },
  };

  const list: Command = {
    name: 'list',
    description: copy.commands.list,
    guildOnly: true,
    permissions: ['ManageGuild'],
    args: [{ name: 'page', type: 'integer', min: 1, max: 20, optional: true }],
    examples: ['backup list', 'backup list 2'],
    async run(ctx) {
      const { voice } = ctx.services;
      const rows = await store.list(ctx.guildId, 200);
      if (rows.length === 0) {
        await ctx.reply(voice.empty('backups.list', copy.empty(ctx.prefix), ctx.seed));
        return;
      }
      const pages = chunk(rows, PAGE_SIZE).map((group) => ({
        color: palette.south,
        title: copy.listTitle,
        description: lines(
          ...group.map((row) =>
            lines(
              copy.listLine(
                row.number,
                copy.kinds[row.kind],
                timestamp(row.createdAt, 'f'),
                row.roleCount,
                row.channelCount,
              ),
              row.label ? copy.listLabel(row.label) : null,
            ),
          ),
          '',
          subtext(copy.listFooter),
        ),
      }));
      await ctx.services.pages.send(ctx, pages, (ctx.args.number('page') ?? 1) - 1);
    },
  };

  return {
    name: 'backup',
    aliases: ['backups'],
    description: copy.commands.backup,
    guildOnly: true,
    subcommands: [now, list],
  };
}
