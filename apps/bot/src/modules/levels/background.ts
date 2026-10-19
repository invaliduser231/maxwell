import type { LevelStore } from '@maxwell/core/stores/levels';
import { type Image, loadImage } from '@napi-rs/canvas';
import type { CardStyles } from '../../cards/styles.js';
import type { CardStyle } from '../../cards/theme.js';

export interface BackgroundSource {
  background(guildId: string, userId: string): Promise<string | null>;
}

export function withBackground(style: CardStyle, image: Image | null, dim: number): CardStyle {
  if (!image) return style;
  return { ...style, backdrop: { kind: 'image', image, dim } };
}

export async function memberBackground(
  wallets: BackgroundSource,
  store: Pick<LevelStore, 'asset'>,
  guildId: string,
  userId: string,
): Promise<Image | null> {
  const key = await wallets.background(guildId, userId).catch(() => null);
  if (!key) return null;
  const data = await store.asset(guildId, key).catch(() => null);
  if (!data) return null;
  try {
    return await loadImage(Buffer.from(data));
  } catch {
    return null;
  }
}

export async function rankStyle(
  cards: CardStyles,
  wallets: BackgroundSource,
  store: Pick<LevelStore, 'asset'>,
  guildId: string,
  userId: string,
): Promise<CardStyle> {
  const [style, image] = await Promise.all([
    cards.forGuild(guildId),
    memberBackground(wallets, store, guildId, userId),
  ]);
  if (!image) return style;
  const { dim } = await cards.config(guildId);
  return withBackground(style, image, dim);
}
