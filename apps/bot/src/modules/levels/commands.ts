import { type LevelsConfig, levelFromXp, type levelsConfig } from '@maxwell/core/modules/levels';
import type { LevelStore, Standing } from '@maxwell/core/stores/levels';
import { loadAvatar } from '../../cards/avatar.js';
import { renderLeaderboard } from '../../cards/leaderboard.js';
import { renderRank } from '../../cards/rank.js';
import { mention } from '../../commands/mentions.js';
import type { Command, GuildContext } from '../../commands/types.js';
import type { Embed, UserRef } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { code, count, lines, subtext } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { type BackgroundSource, rankStyle } from './background.js';
import type { CardPage, CardPager } from './board.js';
import { audit, copy } from './copy.js';
import type { LevelTracker } from './tracker.js';

type Context = ModuleContext<typeof levelsConfig>;

const PAGE_SIZE = 10;
const MAX_AMOUNT = 10_000_000;

async function canAttach(ctx: GuildContext): Promise<boolean> {
  const missing = await ctx.platform.missingBotPermissions(ctx.guildId, ctx.message.channelId, [
    'AttachFiles',
  ]);
  return missing.length === 0;
}

function userName(user: UserRef | null, userId: string): string {
  return user ? `@${user.username}` : userId;
}

export function levelCommands(
  module: Context,
  store: LevelStore,
  tracker: LevelTracker,
  pager: CardPager,
  wallets: BackgroundSource,
): Command[] {
  const rank: Command = {
    name: 'rank',
    description: copy.rankDescription,
    guildOnly: true,
    cooldown: 5_000,
    args: [{ name: 'member', type: 'user', optional: true }],
    examples: ['rank', 'rank @Lena'],
    async run(ctx) {
      const { voice, platform, cards } = ctx.services;
      const userId = ctx.args.string('member') ?? ctx.message.author.id;
      const self = userId === ctx.message.author.id;
      const standing = await store.standing(ctx.guildId, userId);
      if (!standing) {
        await ctx.reply(
          self ? voice.empty('levels.rank', copy.noXpSelf, ctx.seed) : copy.noXpOther(userId),
        );
        return;
      }

      const config = await module.config(ctx.guildId);
      const progress = levelFromXp(standing.xp, config.curve);
      const user = self ? ctx.message.author : await platform.user(userId);

      if (user && (await canAttach(ctx))) {
        const style = await rankStyle(cards, wallets, store, ctx.guildId, userId);
        const face = await loadAvatar(user.avatarUrl, user.displayName, style.theme);
        const image = await renderRank({
          name: user.displayName,
          username: user.username,
          avatar: face,
          level: progress.level,
          rank: standing.rank,
          xp: progress.into,
          needed: progress.needed,
          style,
        });
        await ctx.reply({ files: [{ name: 'rank.png', data: image }] });
        return;
      }

      const total = await store.ranked(ctx.guildId);
      await ctx.reply({
        embeds: [
          {
            color: palette.north,
            author: user ? { name: user.displayName, iconUrl: user.avatarUrl } : undefined,
            thumbnailUrl: user?.avatarUrl,
            description: lines(
              user ? null : mention.user(userId),
              copy.rankLine(progress.level, progress.into, progress.needed),
              copy.rankPlace(standing.rank, total),
              copy.totalXp(standing.xp),
            ),
          },
        ],
      });
    },
  };

  const levels: Command = {
    name: 'levels',
    description: copy.levelsDescription,
    guildOnly: true,
    cooldown: 5_000,
    args: [{ name: 'page', type: 'integer', min: 1, max: 1000, optional: true }],
    examples: ['levels', 'levels 2'],
    async run(ctx) {
      const { voice, platform, cards } = ctx.services;
      const total = await store.ranked(ctx.guildId);
      if (total === 0) {
        await ctx.reply(voice.empty('levels.board', copy.emptyBoard, ctx.seed));
        return;
      }

      const pages = Math.ceil(total / PAGE_SIZE);
      const page = ctx.args.number('page') ?? 1;
      if (page > pages) {
        await ctx.reply({ content: copy.pageTooFar(pages), deleteAfter: 15_000 });
        return;
      }

      const config = await module.config(ctx.guildId);
      const own = await store.standing(ctx.guildId, ctx.message.author.id);
      const you = own
        ? copy.boardYou(own.rank, levelFromXp(own.xp, config.curve).level)
        : copy.boardNotYou;

      if (await canAttach(ctx)) {
        const [style, guild] = await Promise.all([
          cards.forGuild(ctx.guildId),
          platform.guild(ctx.guildId),
        ]);
        const community = guild?.name ?? copy.community;
        const paging = await pager.canPage(ctx.guildId, ctx.message.channelId);
        const render = async (wanted: number): Promise<CardPage | null> => {
          const ranked = await store.ranked(ctx.guildId);
          const count = Math.ceil(ranked / PAGE_SIZE);
          if (count === 0) return null;
          const current = Math.min(wanted, count);
          const rows = await store.leaderboard(ctx.guildId, PAGE_SIZE, (current - 1) * PAGE_SIZE);
          const people = await Promise.all(
            rows.map(async (row) => {
              const user = await platform.user(row.userId).catch(() => null);
              const name = user?.displayName ?? row.userId;
              return {
                row,
                name,
                avatar: await loadAvatar(user?.avatarUrl ?? null, name, style.theme),
              };
            }),
          );
          const image = await renderLeaderboard({
            title: copy.boardTitle,
            subtitle: copy.boardSubtitle(community, current, count),
            rows: people.map(({ row, name, avatar }) => ({
              rank: row.rank,
              name,
              avatar,
              value: copy.levelValue(levelFromXp(row.xp, config.curve).level),
              detail: copy.xpValue(row.xp),
              highlight: row.userId === ctx.message.author.id,
            })),
            style,
          });
          return {
            image,
            pages: count,
            content: lines(
              subtext(you),
              !paging.react && current < count && subtext(copy.boardNext(ctx.prefix, current + 1)),
            ),
          };
        };
        await pager.start({
          guildId: ctx.guildId,
          channelId: ctx.message.channelId,
          userId: ctx.message.author.id,
          page,
          render,
          send: (first) =>
            ctx.reply({
              content: first.content,
              files: [{ name: 'leaderboard.png', data: first.image }],
            }),
        });
        return;
      }

      const rows = await store.leaderboard(ctx.guildId, Math.min(total, PAGE_SIZE * 10), 0);
      const embeds = textPages(rows, config, you);
      await ctx.services.pages.send(ctx, embeds, page - 1);
    },
  };

  const adjust = (kind: 'give' | 'take'): Command => ({
    name: kind,
    description: kind === 'give' ? copy.giveDescription : copy.takeDescription,
    guildOnly: true,
    permissions: ['ManageGuild'],
    args: [
      { name: 'member', type: 'user' },
      { name: 'amount', type: 'integer', min: 1, max: MAX_AMOUNT },
    ],
    examples: [`xp ${kind} @Lena 500`],
    async run(ctx) {
      const userId = ctx.args.string('member') as string;
      const amount = ctx.args.number('amount') as number;
      const user = await ctx.platform.user(userId);
      if (user?.bot) {
        await ctx.reply({ content: copy.botTarget, deleteAfter: 15_000 });
        return;
      }
      const result = await store.add(ctx.guildId, userId, kind === 'give' ? amount : -amount);
      const config = await module.config(ctx.guildId);
      const level = levelFromXp(result.after, config.curve).level;
      const name = userName(user, userId);
      await module.record(
        ctx.guildId,
        { id: ctx.message.author.id },
        kind === 'give' ? 'xp.give' : 'xp.take',
        kind === 'give' ? audit.give(amount, name) : audit.take(result.before - result.after, name),
        {
          before: { userId, xp: result.before },
          after: { userId, xp: result.after },
          undo: { kind: 'xp.set', payload: { userId, xp: result.before } },
        },
      );
      await tracker.sync(ctx.guildId, userId, result.after);
      const detail =
        kind === 'give'
          ? copy.gave(amount, userId, level)
          : copy.took(result.before - result.after, userId, level);
      await ctx.reply(ctx.services.voice.done(detail, ctx.seed));
    },
  });

  const reset: Command = {
    name: 'reset',
    description: copy.resetDescription,
    guildOnly: true,
    permissions: ['ManageGuild'],
    args: [{ name: 'member', type: 'user' }],
    examples: ['xp reset @Lena'],
    async run(ctx) {
      const userId = ctx.args.string('member') as string;
      const before = await store.remove(ctx.guildId, userId);
      if (before <= 0) {
        await ctx.reply({ content: copy.nothingToReset(userId), deleteAfter: 15_000 });
        return;
      }
      const user = await ctx.platform.user(userId);
      await module.record(
        ctx.guildId,
        { id: ctx.message.author.id },
        'xp.reset',
        audit.reset(userName(user, userId)),
        {
          before: { userId, xp: before },
          after: { userId, xp: 0 },
          undo: { kind: 'xp.set', payload: { userId, xp: before } },
        },
      );
      await tracker.sync(ctx.guildId, userId, 0);
      await ctx.reply(ctx.services.voice.done(copy.reset(userId), ctx.seed));
    },
  };

  const xp: Command = {
    name: 'xp',
    description: copy.xpDescription,
    guildOnly: true,
    permissions: ['ManageGuild'],
    subcommands: [adjust('give'), adjust('take'), reset],
  };

  return [rank, levels, xp];
}

function textPages(rows: Standing[], config: LevelsConfig, you: string): Embed[] {
  const pages: Embed[] = [];
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const group = rows.slice(i, i + PAGE_SIZE);
    const width = String(rows.length).length + 1;
    pages.push({
      color: palette.north,
      title: copy.boardTitle,
      description: lines(
        ...group.map((row) => {
          const level = levelFromXp(row.xp, config.curve).level;
          return `${code(`#${row.rank}`.padEnd(width))}  ${mention.user(row.userId)}  level ${count(level)}`;
        }),
        '',
        subtext(you),
      ),
    });
  }
  return pages;
}
