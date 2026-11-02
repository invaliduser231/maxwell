import { type InsightsStore, type Range, utcDay } from '@maxwell/core/stores/insights';
import { fillDays, renderActivity } from '../../cards/activity.js';
import type { Command, GuildContext } from '../../commands/types.js';
import { lines, timestamp } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { copy } from './copy.js';

const DAY = 86_400_000;
const DEFAULT_DAYS = 30;

export function lastDays(days: number, now = Date.now()): Range {
  const to = Math.floor(now / DAY) * DAY + DAY;
  return { from: new Date(to - days * DAY), to: new Date(to) };
}

export function statsCommand(store: InsightsStore, flush: () => Promise<unknown>): Command {
  const days = (ctx: GuildContext) => ctx.args.number('days') ?? DEFAULT_DAYS;
  const daysArg = { name: 'days', type: 'integer' as const, min: 7, max: 90, optional: true };

  const channels: Command = {
    name: 'channels',
    description: copy.commands.channels,
    guildOnly: true,
    args: [daysArg],
    examples: ['stats channels', 'stats channels 7'],
    async run(ctx) {
      await flush();
      const range = lastDays(days(ctx));
      const [text, voice] = await Promise.all([
        store.topChannels(ctx.guildId, range, 10),
        store.topVoiceChannels(ctx.guildId, range, 5),
      ]);
      const fields = [
        text.length > 0
          ? {
              name: copy.text,
              value: lines(
                ...text.map((row, i) =>
                  copy.channelLine(i + 1, row.channelId, copy.messages(row.count)),
                ),
              ),
            }
          : null,
        voice.length > 0
          ? {
              name: copy.voice,
              value: lines(
                ...voice.map((row, i) =>
                  copy.channelLine(i + 1, row.channelId, copy.minutes(row.count)),
                ),
              ),
            }
          : null,
      ].filter((field) => field !== null);
      await ctx.reply({
        embeds: [
          {
            color: palette.south,
            title: copy.channelsTitle(days(ctx)),
            description: fields.length === 0 ? copy.nothing : undefined,
            fields,
          },
        ],
      });
    },
  };

  const members: Command = {
    name: 'members',
    description: copy.commands.members,
    guildOnly: true,
    permissions: ['ManageGuild'],
    args: [daysArg],
    examples: ['stats members', 'stats members 7'],
    async run(ctx) {
      await flush();
      const top = await store.topMembers(ctx.guildId, lastDays(days(ctx)), 10);
      await ctx.reply({
        embeds: [
          {
            color: palette.south,
            title: copy.membersTitle(days(ctx)),
            description:
              top.length === 0
                ? copy.nothing
                : lines(
                    ...top.map((row, i) =>
                      copy.memberLine(i + 1, row.userId, copy.messages(row.count)),
                    ),
                  ),
          },
        ],
      });
    },
  };

  const user: Command = {
    name: 'user',
    aliases: ['me'],
    description: copy.commands.user,
    guildOnly: true,
    args: [{ name: 'user', type: 'user', optional: true }],
    examples: ['stats me', 'stats user @alex'],
    async run(ctx) {
      const author = ctx.message.author.id;
      const target = ctx.args.string('user') ?? author;
      if (
        target !== author &&
        !(await ctx.platform.hasPermissions(ctx.guildId, author, null, ['ModerateMembers']))
      ) {
        await ctx.reply(copy.others);
        return;
      }
      await flush();
      const range = lastDays(DEFAULT_DAYS);
      const from = utcDay(range.from);
      const { activity } = await store.member(ctx.guildId, target);
      const recent = activity.filter((row) => row.day >= from && row.messages > 0);
      const total = recent.reduce((sum, row) => sum + row.messages, 0);
      const latest = activity.filter((row) => row.messages > 0).at(-1);
      const person = await ctx.platform.user(target);
      await ctx.reply({
        embeds: [
          {
            color: palette.south,
            title: copy.userTitle(person?.displayName ?? target),
            thumbnailUrl: person?.avatarUrl,
            description: lines(
              total > 0
                ? copy.userLines(total, recent.length, DEFAULT_DAYS)
                : copy.quiet(DEFAULT_DAYS),
              latest ? copy.lastSeen(timestamp(new Date(`${latest.day}T12:00:00Z`), 'D')) : null,
            ),
          },
        ],
      });
    },
  };

  return {
    name: 'stats',
    aliases: ['server', 'activity'],
    description: copy.commands.stats,
    guildOnly: true,
    cooldown: 15_000,
    args: [daysArg],
    examples: ['stats', 'stats 7', 'stats 90'],
    subcommands: [channels, members, user],
    async run(ctx) {
      const { platform, cards, log } = ctx.services;
      const count = days(ctx);
      const range = lastDays(count);
      try {
        await flush();
        const [summary, messages, flow, guild, style] = await Promise.all([
          store.summary(ctx.guildId, range),
          store.messages(ctx.guildId, range, 'day', 'UTC'),
          store.memberFlow(ctx.guildId, range),
          platform.guild(ctx.guildId),
          cards.forGuild(ctx.guildId),
        ]);
        const image = await renderActivity({
          community: guild?.name ?? ctx.guildId,
          days: fillDays(utcDay(range.from), count, messages, flow),
          messages: summary.messages,
          active: summary.activeMembers,
          joins: summary.joins,
          leaves: summary.leaves,
          voiceMinutes: summary.voiceMinutes,
          style,
        });
        await ctx.reply({ files: [{ name: 'activity.png', data: image }] });
      } catch (error) {
        log.warn({ err: error, guild: ctx.guildId }, 'activity card failed');
        await ctx.reply(copy.failed);
      }
    },
  };
}
