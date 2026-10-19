import { mention } from '../../commands/mentions.js';
import type { Command } from '../../commands/types.js';
import { code, count, lines, subtext, timestamp } from '../../ui/format.js';
import { chunk } from '../../ui/paginator.js';
import { palette } from '../../ui/palette.js';
import { inviteConfig, MODULE } from './config.js';
import { audit, copy } from './copy.js';
import type { InviteStore } from './store.js';
import { describeSource } from './tracker.js';

const PAGE_SIZE = 10;

export function inviteCommands(store: InviteStore): Command {
  const top: Command = {
    name: 'top',
    aliases: ['leaderboard', 'lb'],
    description: copy.commands.top,
    guildOnly: true,
    cooldown: 5_000,
    args: [{ name: 'page', type: 'integer', min: 1, max: 10, optional: true }],
    examples: ['invites top', 'invites top 2'],
    async run(ctx) {
      const { voice } = ctx.services;
      const rows = await store.leaderboard(ctx.guildId, PAGE_SIZE * 10);
      if (rows.length === 0) {
        await ctx.reply(voice.empty('invites.top', copy.top.empty, ctx.seed));
        return;
      }

      const own = await store.rank(ctx.guildId, ctx.message.author.id);
      const width = String(rows.length).length + 1;
      const you = own ? subtext(copy.top.you(own.rank, own.active)) : subtext(copy.top.notOnBoard);

      const pages = chunk(rows, PAGE_SIZE).map((group, page) => ({
        color: palette.north,
        title: copy.top.title,
        description: lines(
          ...group.map((row, i) => {
            const place = code(`#${page * PAGE_SIZE + i + 1}`.padEnd(width));
            const left = row.total - row.active;
            const extra = left > 0 ? `  *${copy.top.left(left)}*` : '';
            return `${place}  ${mention.user(row.inviterId)}  **${count(row.active)}**${extra}`;
          }),
          '',
          you,
        ),
      }));

      await ctx.services.pages.send(ctx, pages, (ctx.args.number('page') ?? 1) - 1);
    },
  };

  const who: Command = {
    name: 'who',
    aliases: ['inviter'],
    description: copy.commands.who,
    guildOnly: true,
    args: [{ name: 'member', type: 'user', optional: true }],
    examples: ['invites who @Lena'],
    async run(ctx) {
      const userId = ctx.args.string('member') ?? ctx.message.author.id;
      const join = await store.latestJoin(ctx.guildId, userId);
      const who = mention.user(userId);
      if (!join) {
        await ctx.reply(copy.who.before(who));
        return;
      }
      const when = timestamp(join.joinedAt, 'R');
      if (!join.resolvedAt) {
        await ctx.reply(copy.who.looking(who, when));
        return;
      }
      if (join.joinSource === null) {
        await ctx.reply(copy.who.unknown(who, when));
        return;
      }
      const source = {
        type: join.joinSource,
        inviteCode: join.inviteCode,
        inviterId: join.inviterId,
      };
      await ctx.reply(copy.who.through(who, when, describeSource(source)));
    },
  };

  const log: Command = {
    name: 'log',
    description: copy.commands.log,
    guildOnly: true,
    permissions: ['ManageGuild'],
    args: [{ name: 'channel', type: 'word', optional: true }],
    examples: ['invites log #welcome', 'invites log off'],
    async run(ctx) {
      const { voice, modules } = ctx.services;
      const input = ctx.args.string('channel');
      if (!input) {
        const config = await modules.get(ctx.guildId, MODULE, inviteConfig);
        await ctx.reply(
          config.logChannelId
            ? copy.log.current(mention.channel(config.logChannelId))
            : lines(copy.log.off, subtext(copy.log.turnOn(ctx.prefix))),
        );
        return;
      }

      if (input.toLowerCase() === 'off') {
        await modules.update(
          ctx.guildId,
          MODULE,
          { logChannelId: null },
          { id: ctx.message.author.id },
          audit.logOff,
        );
        await ctx.reply(voice.done(copy.log.off, ctx.seed));
        return;
      }

      const channelId = /^<#(\d+)>$/.exec(input)?.[1] ?? (/^\d+$/.test(input) ? input : null);
      if (!channelId || !(await ctx.platform.channelInGuild(ctx.guildId, channelId))) {
        await ctx.reply({ content: copy.log.notChannel, deleteAfter: 15_000 });
        return;
      }

      const missing = await ctx.platform.missingBotPermissions(ctx.guildId, channelId, [
        'SendMessages',
        'EmbedLinks',
      ]);
      if (missing.length) {
        await ctx.reply(
          voice.botMissingPermissions(missing, copy.log.where(mention.channel(channelId))),
        );
        return;
      }

      await modules.update(
        ctx.guildId,
        MODULE,
        { logChannelId: channelId },
        { id: ctx.message.author.id },
        audit.logChannel,
      );
      await ctx.reply(voice.done(copy.log.set(mention.channel(channelId)), ctx.seed));
    },
  };

  return {
    name: 'invites',
    aliases: ['invite', 'inv'],
    description: copy.commands.invites,
    guildOnly: true,
    args: [{ name: 'member', type: 'user', optional: true }],
    examples: ['invites', 'invites @Lena'],
    subcommands: [top, who, log],
    async run(ctx) {
      const { voice } = ctx.services;
      const userId = ctx.args.string('member') ?? ctx.message.author.id;
      const self = userId === ctx.message.author.id;
      const stats = await store.inviterStats(ctx.guildId, userId);

      if (stats.total === 0) {
        await ctx.reply(
          self
            ? voice.empty('invites.self', copy.stats.selfEmpty, ctx.seed)
            : copy.stats.otherEmpty(mention.user(userId)),
        );
        return;
      }

      const subject = self ? copy.stats.you : mention.user(userId);
      const stayed =
        stats.active === stats.total
          ? stats.total === 1
            ? copy.stats.stayedOne
            : copy.stats.stayedAll
          : copy.stats.stillHere(stats.active);
      await ctx.reply(
        lines(
          copy.stats.brought(subject, stats.total, stayed),
          stats.left > 0 && subtext(copy.stats.leftAgain(stats.left)),
        ),
      );
    },
  };
}
