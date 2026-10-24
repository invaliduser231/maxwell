'use server';

import { randomUUID } from 'node:crypto';
import { collectionConfig } from '@maxwell/core/modules/collection';
import { CollectionStore } from '@maxwell/core/stores/collection';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Result } from '@/lib/actions';
import { db } from '@/lib/db';
import { editor } from '@/lib/guard';
import { type CardView, cardView } from './cards';

const IMAGE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE = 1_000_000;
const cardId = z.string().regex(/^\d{1,18}$/);

const cardInput = z.object({
  deck: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(200).default(''),
  rarity: z.string().min(1).max(32),
  image: z.string().nullable(),
});

export async function addCard(guildId: string, input: unknown): Promise<Result<CardView>> {
  const check = await editor(guildId, 'collection');
  if ('error' in check) return { ok: false, error: check.error };
  const parsed = cardInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Give the card a name.' };
  const { sql, modules, audit } = db();
  const config = await modules.get(guildId, 'collection', collectionConfig);
  const deck = config.decks.find((entry) => entry.id === parsed.data.deck);
  if (!deck) return { ok: false, error: 'Save the deck first.' };
  if (!config.tiers.some((tier) => tier.id === parsed.data.rarity)) {
    return { ok: false, error: 'Pick a rarity.' };
  }
  let image: { type: string; data: Buffer } | null = null;
  if (parsed.data.image) {
    const match = IMAGE.exec(parsed.data.image);
    const data = match?.[2] ? Buffer.from(match[2], 'base64') : null;
    if (!match?.[1] || !data || data.length === 0 || data.length > MAX_IMAGE) {
      return { ok: false, error: 'Use a PNG, JPEG or WebP under 1 MB.' };
    }
    image = { type: match[1], data };
  }
  const assetKey = image ? `card-${randomUUID().slice(0, 12)}` : null;
  if (image && assetKey) {
    await sql.begin(async (tx) => {
      await tx`insert into guilds (id) values (${guildId}) on conflict (id) do nothing`;
      await tx`
        insert into guild_assets (guild_id, key, content_type, data)
        values (${guildId}, ${assetKey}, ${image.type}, ${image.data})
      `;
    });
  }
  const store = new CollectionStore(sql);
  const card = await store.createCard(guildId, {
    deck: deck.id,
    name: parsed.data.name,
    description: parsed.data.description,
    rarity: parsed.data.rarity,
    assetKey,
  });
  await audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: 'collection',
    action: 'card.create',
    summary: `Added ${card.name} to ${deck.name}`,
    after: { id: card.id, deck: card.deck, name: card.name, rarity: card.rarity },
    undo: null,
  });
  revalidatePath(`/g/${guildId}/collection`);
  return { ok: true, data: cardView({ ...card, owners: 0 }) };
}

export async function setCardActive(guildId: string, id: string, active: boolean): Promise<Result> {
  const check = await editor(guildId, 'collection');
  if ('error' in check) return { ok: false, error: check.error };
  if (!cardId.safeParse(id).success) return { ok: false, error: 'That card is gone.' };
  const store = new CollectionStore(db().sql);
  const card = await store.card(guildId, id);
  if (!card || card.memberId) return { ok: false, error: 'That card is gone.' };
  await store.updateCard(guildId, id, { active });
  await db().audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: 'collection',
    action: active ? 'card.activate' : 'card.retire',
    summary: active ? `Brought back ${card.name}` : `Retired ${card.name}`,
    before: { active: card.active },
    after: { active },
    undo: null,
  });
  revalidatePath(`/g/${guildId}/collection`);
  return { ok: true };
}

export async function removeCard(guildId: string, id: string): Promise<Result> {
  const check = await editor(guildId, 'collection');
  if ('error' in check) return { ok: false, error: check.error };
  if (!cardId.safeParse(id).success) return { ok: false, error: 'That card is gone.' };
  const { sql, audit } = db();
  const store = new CollectionStore(sql);
  const card = await store.card(guildId, id);
  if (!card || card.memberId) return { ok: false, error: 'That card is gone.' };
  await store.deleteCard(guildId, id);
  if (card.assetKey?.startsWith('card-')) {
    await sql`delete from guild_assets where guild_id = ${guildId} and key = ${card.assetKey}`;
  }
  await audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: 'collection',
    action: 'card.delete',
    summary: `Deleted ${card.name}`,
    before: { id: card.id, deck: card.deck, name: card.name, rarity: card.rarity },
    undo: null,
  });
  revalidatePath(`/g/${guildId}/collection`);
  return { ok: true };
}
