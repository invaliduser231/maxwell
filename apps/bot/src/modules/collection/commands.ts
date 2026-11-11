import { mention, userId as parseUser } from '../../commands/mentions.js';
import type { Command, GuildContext } from '../../commands/types.js';
import type { Embed } from '../../platform/types.js';
import { code, count, lines, subtext } from '../../ui/format.js';
import { chunk } from '../../ui/paginator.js';
import { palette } from '../../ui/palette.js';
import { money } from '../economy/wallets.js';
import type { Activity } from './activity.js';
import { copy } from './copy.js';
import { setCards, setProgress, tierOf } from './draw.js';
import type { Drops } from './drops.js';
import { cardFile, hexColor } from './drops.js';
import { listPacks, openPack } from './packs.js';
import { renderCard } from './render.js';
import type { Collection } from './service.js';
import type { Trades } from './trades.js';

const PAGE_SIZE = 15;
const SETS_PAGE = 8;
const USAGE = 15_000;
const WISHLIST_LIMIT = 25;

export interface CollectionDeps {
  collection: Collection;
  trades: Trades;
  activity: Activity;
  drops: Drops;
  refreshRarity(guildId: string): Promise<void>;
}

async function listCollection(
  ctx: GuildContext,
  collection: Collection,
  userId: string,
): Promise<void> {
  const { voice } = ctx.services;
  const config = await collection.config(ctx.guildId);
  const owned = await collection.store.owned(ctx.guildId, userId, { limit: 1_500 });
  const self = userId === ctx.message.author.id;
  if (owned.length === 0) {
    await ctx.reply(
      self
        ? voice.empty('collection.view', copy.summary.emptySelf, ctx.seed)
        : copy.summary.emptyOther(userId),
    );
    return;
  }
  const total = owned.reduce((sum, card) => sum + card.count, 0);
  const pages: Embed[] = chunk(owned, PAGE_SIZE).map((group) => ({
    color: palette.north,
    title: copy.view.title,
    description: lines(
      copy.view.header(userId, total, owned.length),
      '',
      ...group.map((card) => {
        const tier = tierOf(config.tiers, card.rarity);
        const extra = card.count > 1 ? `  x${count(card.count)}` : '';
        return `${code(`#${card.number}`)}  **${card.name}**  ${tier.name}${extra}`;
      }),
    ),
  }));
  await ctx.services.pages.send(ctx, pages);
}

async function showCard(ctx: GuildContext, collection: Collection, query: string): Promise<void> {
  const card = await collection.resolveCard(ctx.guildId, query);
  if (!card) {
    await ctx.reply({ content: copy.view.unknown(query), deleteAfter: USAGE });
    return;
  }
  const config = await collection.config(ctx.guildId);
  const tier = tierOf(config.tiers, card.rarity);
  const [owners, mine, wishers] = await Promise.all([
    collection.store.owners(ctx.guildId, card.id),
    collection.store.ownedCounts(ctx.guildId, ctx.message.author.id, [card.id]),
    collection.store.wishers(ctx.guildId, card.id, 50),
  ]);
  const yours = mine.get(card.id) ?? 0;
  const style = await collection.style(ctx.guildId);
  const face = await collection.faces.face(ctx.guildId, card, config, style);
  const image = await renderCard(face, style);
  await ctx.reply({
    files: [{ name: cardFile(card), data: image }],
    embeds: [
      {
        color: hexColor(tier.color),
        title: card.name,
        description: lines(
          card.description || null,
          card.description ? '' : null,
          `**${copy.view.rarity}** ${tier.name}`,
          `**${copy.view.deck}** ${face.deck}`,
          `**${copy.view.owners}** ${count(owners)}`,
          yours > 0 && `**${copy.view.yours}** ${count(yours)}`,
          wishers.length > 0 && `**${copy.view.wished}** ${count(wishers.length)}`,
          !card.active && subtext(copy.view.retired),
        ),
        imageUrl: `attachment://${cardFile(card)}`,
      },
    ],
  });
}

export function collectionCommands(deps: CollectionDeps): Command[] {
  const { collection, trades, activity } = deps;
  const store = collection.store;

  const view: Command = {
    name: 'view',
    aliases: ['show'],
    description: copy.commands.view,
    guildOnly: true,
    cooldown: 3_000,
    botPermissions: ['EmbedLinks', 'AttachFiles'],
    args: [{ name: 'card or member', type: 'text', optional: true }],
    examples: ['cards view', 'cards view @Lena', 'cards view #12', 'cards view dragon'],
    async run(ctx) {
      const input = ctx.args.string('card or member')?.trim();
      if (!input) return listCollection(ctx, collection, ctx.message.author.id);
      const user = parseUser(input);
      if (user) return listCollection(ctx, collection, user);
      return showCard(ctx, collection, input);
    },
  };

  const pack: Command = {
    name: 'pack',
    aliases: ['open'],
    description: copy.commands.pack,
    guildOnly: true,
    cooldown: 3_000,
    botPermissions: ['EmbedLinks'],
    args: [{ name: 'pack', type: 'text', optional: true }],
    examples: ['cards pack', 'cards pack standard'],
    run: (ctx) => openPack(ctx, collection, ctx.args.string('pack')),
  };

  const packs: Command = {
    name: 'packs',
    description: copy.commands.packs,
    guildOnly: true,
    cooldown: 3_000,
    botPermissions: ['EmbedLinks'],
    examples: ['cards packs'],
    run: (ctx) => listPacks(ctx, collection),
  };

  const trade: Command = {
    name: 'trade',
    description: copy.commands.trade,
    guildOnly: true,
    cooldown: 5_000,
    botPermissions: ['AddReactions'],
    args: [
      { name: 'member', type: 'user' },
      { name: 'cards', type: 'text' },
    ],
    examples: [
      'cards trade @Lena #12 #14 for #33',
      'cards trade @Lena for #33',
      'cards trade @Lena #12',
    ],
    run: (ctx) =>
      trades.propose(ctx, ctx.args.string('member') as string, ctx.args.string('cards') ?? ''),
  };

  const wishlist: Command = {
    name: 'wishlist',
    aliases: ['wish', 'wl'],
    description: copy.commands.wishlist,
    guildOnly: true,
    cooldown: 2_000,
    args: [
      { name: 'add|remove', type: 'word', optional: true },
      { name: 'card', type: 'text', optional: true },
    ],
    examples: ['cards wishlist', 'cards wishlist add dragon', 'cards wishlist remove #12'],
    async run(ctx) {
      const { voice } = ctx.services;
      const userId = ctx.message.author.id;
      const action = ctx.args.string('add|remove')?.toLowerCase();
      const rest = ctx.args.string('card')?.trim() ?? '';
      const config = await collection.config(ctx.guildId);

      if (!action) {
        const cards = await store.wishlist(ctx.guildId, userId);
        if (cards.length === 0) {
          await ctx.reply(voice.empty('collection.wishlist', copy.wishlist.empty, ctx.seed));
          return;
        }
        const pages = chunk(cards, 15).map((group) => ({
          color: palette.north,
          title: copy.wishlist.title,
          description: lines(
            ...group.map(
              (card) =>
                `${code(`#${card.number}`)}  **${card.name}**  ${tierOf(config.tiers, card.rarity).name}`,
            ),
          ),
        }));
        await ctx.services.pages.send(ctx, pages);
        return;
      }

      const removing = action === 'remove' || action === 'rm';
      const query = action === 'add' || removing ? rest : [action, rest].filter(Boolean).join(' ');
      if (!query) {
        await ctx.reply({
          content: voice.usage(copy.wishlist.which, copy.wishlist.usage(ctx.prefix)),
          deleteAfter: USAGE,
        });
        return;
      }
      const card = await collection.resolveCard(ctx.guildId, query);
      if (!card) {
        await ctx.reply({ content: copy.view.unknown(query), deleteAfter: USAGE });
        return;
      }
      if (removing) {
        const gone = await store.unwish(ctx.guildId, userId, card.id);
        await ctx.reply(
          gone
            ? voice.done(copy.wishlist.removed(card.name), ctx.seed)
            : copy.wishlist.notOn(card.name),
        );
        return;
      }
      const result = await store.wish(ctx.guildId, userId, card.id, WISHLIST_LIMIT);
      if (result === 'full') await ctx.reply(copy.wishlist.full(WISHLIST_LIMIT));
      else if (result === 'exists') await ctx.reply(copy.wishlist.exists(card.name));
      else await ctx.reply(voice.done(copy.wishlist.added(card.name), ctx.seed));
    },
  };

  const sets: Command = {
    name: 'sets',
    aliases: ['set'],
    description: copy.commands.sets,
    guildOnly: true,
    cooldown: 3_000,
    async run(ctx) {
      const { voice } = ctx.services;
      const config = await collection.config(ctx.guildId);
      if (config.sets.length === 0) {
        await ctx.reply(voice.empty('collection.sets', copy.sets.empty, ctx.seed));
        return;
      }
      const userId = ctx.message.author.id;
      const [owned, done] = await Promise.all([
        store.ownedIds(ctx.guildId, userId),
        store.setsDone(ctx.guildId, userId),
      ]);
      const deckCards = new Map<string, string[]>();
      for (const set of config.sets) {
        if (set.deckId && !deckCards.has(set.deckId)) {
          const cards = await store.cards(ctx.guildId, { deck: set.deckId, activeOnly: true });
          deckCards.set(
            set.deckId,
            cards.map((card) => card.id),
          );
        }
      }
      const economy = (await collection.wallets.active(ctx.guildId))
        ? await collection.wallets.config(ctx.guildId)
        : null;
      const pages: Embed[] = chunk(config.sets, SETS_PAGE).map((group) => ({
        color: palette.north,
        title: copy.sets.title,
        description: lines(
          ...group.flatMap((set) => {
            const cards = setCards(set, deckCards);
            const have = setProgress(cards, owned);
            const finished = done.has(set.id);
            const rewards = [
              economy && set.rewardAmount > 0 ? money(set.rewardAmount, economy.currency) : null,
              set.rewardRoleId ? mention.role(set.rewardRoleId) : null,
            ].filter((part): part is string => part !== null);
            return [
              `${finished ? voice.icon('ok') : ''}**${set.name}**  ${copy.sets.progress(have, cards.length)}`,
              rewards.length > 0 ? subtext(copy.sets.reward(rewards)) : null,
            ];
          }),
        ),
      }));
      await ctx.services.pages.send(ctx, pages);
    },
  };

  const optin: Command = {
    name: 'optin',
    description: copy.commands.optin,
    guildOnly: true,
    cooldown: 10_000,
    async run(ctx) {
      const { voice, platform } = ctx.services;
      const config = await collection.config(ctx.guildId);
      if (!config.community.enabled) {
        await ctx.reply({ content: copy.optin.off, deleteAfter: USAGE });
        return;
      }
      const userId = ctx.message.author.id;
      const existing = await store.memberCard(ctx.guildId, userId);
      if (existing?.active) {
        await ctx.reply(copy.optin.already);
        return;
      }
      const member = await platform.member(ctx.guildId, userId);
      const name = member?.nick ?? ctx.message.author.displayName;
      await store.optIn(ctx.guildId, userId, name.slice(0, 64), config.tiers[0]?.id ?? 'common');
      activity.forget(ctx.guildId);
      collection.invalidate(ctx.guildId);
      await deps.refreshRarity(ctx.guildId);
      await ctx.reply(voice.done(copy.optin.done, ctx.seed));
    },
  };

  const optout: Command = {
    name: 'optout',
    description: copy.commands.optout,
    guildOnly: true,
    cooldown: 10_000,
    async run(ctx) {
      const { voice } = ctx.services;
      const removed = await store.optOut(ctx.guildId, ctx.message.author.id);
      activity.forget(ctx.guildId);
      collection.invalidate(ctx.guildId);
      await ctx.reply(removed ? voice.done(copy.optout.done, ctx.seed) : copy.optout.notIn);
    },
  };

  const cards: Command = {
    name: 'cards',
    aliases: ['card', 'collection', 'col'],
    description: copy.commands.cards,
    guildOnly: true,
    args: [{ name: 'member', type: 'user', optional: true }],
    examples: ['cards', 'cards @Lena'],
    subcommands: [view, pack, packs, trade, wishlist, sets, optin, optout],
    async run(ctx) {
      const { voice } = ctx.services;
      const userId = ctx.args.string('member') ?? ctx.message.author.id;
      const self = userId === ctx.message.author.id;
      const summary = await store.summary(ctx.guildId, userId);
      if (summary.total === 0) {
        await ctx.reply(
          self
            ? voice.empty('collection.summary', copy.summary.emptySelf, ctx.seed)
            : copy.summary.emptyOther(userId),
        );
        return;
      }
      await ctx.reply(
        lines(
          self
            ? copy.summary.self(summary.total, summary.unique)
            : copy.summary.other(userId, summary.total, summary.unique),
          subtext(copy.summary.hint(ctx.prefix)),
        ),
      );
    },
  };

  const claim: Command = {
    name: 'claim',
    aliases: ['grab'],
    description: copy.commands.claim,
    guildOnly: true,
    cooldown: 2_000,
    async run(ctx) {
      const { voice } = ctx.services;
      const claimed = await deps.drops.claim(
        ctx.guildId,
        ctx.message.channelId,
        ctx.message.author.id,
      );
      if (!claimed) {
        await ctx.reply({ content: copy.claim.nothing, deleteAfter: 8_000 });
        return;
      }
      const config = await collection.config(ctx.guildId);
      const tier = tierOf(config.tiers, claimed.card.rarity);
      await ctx.reply(
        lines(
          voice.done(copy.claim.got(claimed.card.name, tier.name), ctx.seed),
          ...claimed.sets.map((set) => copy.sets.completed(set.name, set.rewards)),
        ),
      );
    },
  };

  return [cards, claim];
}
