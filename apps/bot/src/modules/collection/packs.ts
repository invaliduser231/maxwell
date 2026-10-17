import type { CardPack } from '@maxwell/core/modules/collection';
import type { Card } from '@maxwell/core/stores/collection';
import type { GuildContext } from '../../commands/types.js';
import type { Embed } from '../../platform/types.js';
import { code, lines, subtext } from '../../ui/format.js';
import { money } from '../economy/wallets.js';
import { copy } from './copy.js';
import { drawCards, tierOf } from './draw.js';
import { hexColor } from './drops.js';
import { renderCards } from './render.js';
import type { Collection } from './service.js';

const USAGE = 15_000;

export function findPack(packs: readonly CardPack[], query: string): CardPack | null {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return null;
  return (
    packs.find((pack) => pack.id === wanted) ??
    packs.find((pack) => pack.name.toLowerCase() === wanted) ??
    packs.find((pack) => pack.name.toLowerCase().startsWith(wanted)) ??
    null
  );
}

export async function openPack(
  ctx: GuildContext,
  collection: Collection,
  query: string | undefined,
): Promise<void> {
  const { platform, log } = ctx.services;
  const { store, wallets } = collection;
  const guildId = ctx.guildId;
  const userId = ctx.message.author.id;
  const noise = (content: string) => ctx.reply({ content, deleteAfter: USAGE });
  const config = await collection.config(guildId);
  const packs = config.packs.filter((pack) => pack.enabled);
  if (packs.length === 0) return void (await noise(copy.pack.none));

  let pack: CardPack | null = null;
  if (query) {
    pack = findPack(packs, query);
    if (!pack) return void (await noise(copy.pack.unknown(query, ctx.prefix)));
  } else if (packs.length === 1) {
    pack = packs[0] ?? null;
  } else {
    const held = await wallets.store.inventory(guildId, userId);
    pack =
      packs.find((p) => held.some((item) => item.kind === 'pack' && item.ref === p.id)) ?? null;
    if (!pack) return void (await noise(copy.pack.pick(packs.map((p) => code(p.id)).join(' '))));
  }

  if (!pack) return;
  const pool = await collection.pool(guildId, config, pack.deckId);
  if (pool.length === 0) return void (await noise(copy.pack.empty));

  const prepaid = await wallets.store.takeItem(guildId, userId, 'pack', pack.id);
  if (!prepaid && pack.price > 0) {
    if (!(await wallets.active(guildId))) return void (await noise(copy.pack.economyOff));
    const economy = await wallets.config(guildId);
    await wallets.ensure(guildId, userId, economy);
    const paid = await wallets.store.debit(guildId, userId, pack.price, 'pack', { ref: pack.id });
    if (!paid) {
      const balance = await wallets.store.balance(guildId, userId);
      return void (await noise(
        copy.pack.funds(money(pack.price, economy.currency), money(balance, economy.currency)),
      ));
    }
  }

  const drawn = drawCards(pool, config.tiers, pack.size, pack.guaranteed);
  const fresh = await store.grant(
    guildId,
    userId,
    drawn.map((card) => card.id),
  );
  const byId = await store.cardsByIds(
    guildId,
    drawn.map((card) => card.id),
  );
  const cards = drawn
    .map((card) => byId.get(card.id))
    .filter((card): card is Card => card !== undefined);
  const best = cards.reduce<Card | null>((top, card) => {
    if (!top) return card;
    const rank = (c: Card) => config.tiers.findIndex((tier) => tier.id === c.rarity);
    return rank(card) > rank(top) ? card : top;
  }, null);

  const sets = await collection.checkSets(guildId, userId, cards, config);
  const shown = new Set<string>();
  const embed: Embed = {
    color: hexColor(tierOf(config.tiers, best?.rarity ?? '').color),
    description: lines(
      copy.pack.opened(pack.name, cards.length),
      ...cards.map((card) => {
        const tier = tierOf(config.tiers, card.rarity);
        const isNew = fresh.has(card.id) && !shown.has(card.id);
        shown.add(card.id);
        return `${code(`#${card.number}`)}  **${card.name}**  ${tier.name}${isNew ? `  *${copy.pack.isNew}*` : ''}`;
      }),
      sets.length > 0 && '',
      ...sets.map((set) => copy.sets.completed(set.name, set.rewards)),
      prepaid && subtext(copy.pack.fromInventory),
    ),
  };

  let file: { name: string; data: Uint8Array } | null = null;
  try {
    const style = await collection.style(guildId);
    const faces = await collection.faces.faces(guildId, cards, config, style);
    file = { name: 'pack.png', data: await renderCards(faces, style) };
  } catch (error) {
    log.warn({ err: error, guild: guildId }, 'pack render failed');
  }
  const canAttach =
    file !== null &&
    (await platform.missingBotPermissions(guildId, ctx.message.channelId, ['AttachFiles']))
      .length === 0;
  await ctx.reply({
    embeds: [canAttach ? { ...embed, imageUrl: 'attachment://pack.png' } : embed],
    files: canAttach && file ? [file] : undefined,
  });
}
