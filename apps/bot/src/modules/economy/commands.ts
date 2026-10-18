import { mention } from '../../commands/mentions.js';
import type { Command, GuildContext } from '../../commands/types.js';
import type { Embed } from '../../platform/types.js';
import { code, lines, subtext } from '../../ui/format.js';
import { chunk } from '../../ui/paginator.js';
import { palette } from '../../ui/palette.js';
import { copy } from './copy.js';
import { findItem, type Shop, visibleItems } from './shop.js';
import { short, type Wallets } from './wallets.js';

const PAGE_SIZE = 10;
const SHOP_PAGE = 8;
const NOISE = 8_000;
const USAGE = 15_000;

export function economyCommands(wallets: Wallets, shop: Shop): Command[] {
  const store = wallets.store;

  const balance: Command = {
    name: 'balance',
    aliases: ['bal'],
    description: copy.commands.balance,
    guildOnly: true,
    args: [{ name: 'member', type: 'user', optional: true }],
    examples: ['balance', 'balance @Lena'],
    async run(ctx) {
      const config = await wallets.config(ctx.guildId);
      const userId = ctx.args.string('member') ?? ctx.message.author.id;
      const self = userId === ctx.message.author.id;
      const wallet = await store.wallet(ctx.guildId, userId);
      if (self && wallet.balance === 0) {
        await ctx.reply(
          ctx.services.voice.empty('economy.balance', copy.balance.emptySelf, ctx.seed),
        );
        return;
      }
      const rank = await store.rank(ctx.guildId, userId);
      const meta = [
        rank ? copy.balance.rank(rank.rank) : null,
        self && config.dailyCap !== null
          ? copy.balance.today(wallet.earnedToday, config.dailyCap)
          : null,
      ].filter((part): part is string => part !== null);
      await ctx.reply(
        lines(
          self
            ? copy.balance.self(wallet.balance, config.currency)
            : copy.balance.other(userId, wallet.balance, config.currency),
          meta.length > 0 && subtext(meta.join(' / ')),
        ),
      );
    },
  };

  const daily: Command = {
    name: 'daily',
    description: copy.commands.daily,
    guildOnly: true,
    async run(ctx) {
      const { voice } = ctx.services;
      const config = await wallets.config(ctx.guildId);
      if (!config.daily.enabled) {
        await ctx.reply({ content: copy.daily.off, deleteAfter: USAGE });
        return;
      }
      await wallets.ensure(ctx.guildId, ctx.message.author.id, config);
      const result = await store.claimDaily(ctx.guildId, ctx.message.author.id, config.daily);
      if (!result.ok) {
        const opener = voice.pick('cooldown', copy.daily.slow, ctx.seed);
        await ctx.reply({
          content: `${voice.icon('clock')}${opener} ${copy.daily.wait(`${ctx.prefix}daily`, result.readyAt)}`,
          deleteAfter: NOISE,
        });
        return;
      }
      await ctx.reply(
        lines(
          voice.done(copy.daily.claimed(result.amount, result.streak, config.currency), ctx.seed),
          subtext(copy.daily.next(result.readyAt)),
        ),
      );
    },
  };

  const pay: Command = {
    name: 'pay',
    description: copy.commands.pay,
    guildOnly: true,
    cooldown: 3_000,
    args: [
      { name: 'member', type: 'user' },
      { name: 'amount', type: 'integer', min: 1, max: 1_000_000_000 },
    ],
    examples: ['pay @Lena 250'],
    async run(ctx) {
      const { voice, platform } = ctx.services;
      const target = ctx.args.string('member') as string;
      const amount = ctx.args.number('amount') as number;
      if (target === ctx.message.author.id) {
        await ctx.reply({ content: copy.pay.self, deleteAfter: USAGE });
        return;
      }
      const user = await platform.user(target);
      if (!user) {
        await ctx.reply({ content: copy.pay.unknown, deleteAfter: USAGE });
        return;
      }
      if (user.bot) {
        await ctx.reply({ content: copy.pay.bot, deleteAfter: USAGE });
        return;
      }
      const config = await wallets.config(ctx.guildId);
      await wallets.ensure(ctx.guildId, target, config);
      const result = await store.transfer(
        ctx.guildId,
        ctx.message.author.id,
        target,
        amount,
        config.transferTax,
      );
      if (!result.ok) {
        const have = await store.balance(ctx.guildId, ctx.message.author.id);
        await ctx.reply({ content: copy.pay.broke(have, config.currency), deleteAfter: USAGE });
        return;
      }
      await ctx.reply(
        voice.done(copy.pay.sent(target, result.received, result.tax, config.currency), ctx.seed),
      );
    },
  };

  const shopCommand: Command = {
    name: 'shop',
    description: copy.commands.shop,
    guildOnly: true,
    cooldown: 3_000,
    args: [{ name: 'page', type: 'integer', min: 1, max: 20, optional: true }],
    examples: ['shop', 'shop 2'],
    async run(ctx) {
      const config = await wallets.config(ctx.guildId);
      const items = visibleItems(config.shop);
      if (items.length === 0) {
        await ctx.reply(ctx.services.voice.empty('economy.shop', copy.shop.empty, ctx.seed));
        return;
      }
      const sold = await store.soldCounts(ctx.guildId);
      const pages: Embed[] = chunk(items, SHOP_PAGE).map((group, page) => ({
        color: palette.north,
        title: copy.shop.title,
        description: lines(
          ...group.flatMap((item, i) => {
            const left =
              item.stock === null ? null : Math.max(item.stock - (sold.get(item.id) ?? 0), 0);
            const meta = [
              copy.shop.kinds[item.kind] ?? item.kind,
              left === null ? null : left === 0 ? copy.shop.soldOut : copy.shop.left(left),
            ]
              .filter(Boolean)
              .join(', ');
            return [
              `${code(String(page * SHOP_PAGE + i + 1))}  **${item.name}**  ${short(item.price, config.currency)}`,
              meta,
              item.description || null,
              '',
            ];
          }),
          subtext(copy.shop.hint(ctx.prefix)),
        ),
      }));
      await ctx.services.pages.send(ctx, pages, (ctx.args.number('page') ?? 1) - 1);
    },
  };

  const buy: Command = {
    name: 'buy',
    description: copy.commands.buy,
    guildOnly: true,
    cooldown: 3_000,
    args: [{ name: 'item', type: 'text' }],
    examples: ['buy 1', 'buy vip role'],
    async run(ctx: GuildContext) {
      const config = await wallets.config(ctx.guildId);
      const query = ctx.args.string('item') ?? '';
      const item = findItem(config.shop, query);
      if (!item) {
        await ctx.reply({ content: copy.buy.unknown(query, ctx.prefix), deleteAfter: USAGE });
        return;
      }
      const result = await shop.buy(ctx.guildId, ctx.message.author.id, item, ctx.prefix);
      await ctx.reply(result.ok ? ctx.services.voice.done(result.text, ctx.seed) : result.text);
    },
  };

  const rich: Command = {
    name: 'rich',
    aliases: ['richest'],
    description: copy.commands.rich,
    guildOnly: true,
    cooldown: 5_000,
    args: [{ name: 'page', type: 'integer', min: 1, max: 10, optional: true }],
    examples: ['rich', 'rich 2'],
    async run(ctx) {
      const config = await wallets.config(ctx.guildId);
      const rows = await store.richest(ctx.guildId, PAGE_SIZE * 10);
      if (rows.length === 0) {
        await ctx.reply(ctx.services.voice.empty('economy.rich', copy.rich.empty, ctx.seed));
        return;
      }
      const own = await store.rank(ctx.guildId, ctx.message.author.id);
      const width = String(rows.length).length + 1;
      const you = own
        ? subtext(copy.rich.you(own.rank, short(own.balance, config.currency)))
        : subtext(copy.rich.notYou);
      const pages: Embed[] = chunk(rows, PAGE_SIZE).map((group, page) => ({
        color: palette.north,
        title: copy.rich.title,
        description: lines(
          ...group.map((row, i) => {
            const place = code(`#${page * PAGE_SIZE + i + 1}`.padEnd(width));
            return `${place}  ${mention.user(row.userId)}  **${short(row.balance, config.currency)}**`;
          }),
          '',
          you,
        ),
      }));
      await ctx.services.pages.send(ctx, pages, (ctx.args.number('page') ?? 1) - 1);
    },
  };

  return [balance, daily, pay, shopCommand, buy, rich];
}
