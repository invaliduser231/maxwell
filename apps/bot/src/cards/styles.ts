import {
  type Actor,
  type CardsConfig,
  cardsConfig,
  type ModuleStore,
  type Sql,
} from '@maxwell/core';
import { createCanvas, type Image, loadImage } from '@napi-rs/canvas';
import { isPublicHttps } from '../net.js';
import { type CardStyle, makeStyle, readableOnDark } from './theme.js';

export const MODULE = 'cards';
const IMAGE_KEY = 'card-background';
const MAX_SIDE = 1600;
const MAX_BYTES = 8 * 1024 * 1024;

const TTL = 60_000;

export type AccentResult =
  | { ok: true; accent: string | null }
  | { ok: false; reason: 'format' | 'contrast' };

export type ImageResult = { ok: true } | { ok: false; reason: 'source' | 'format' | 'decode' };

export class CardStyles {
  readonly #cache = new Map<string, { style: CardStyle; at: number }>();

  constructor(
    private readonly sql: Sql,
    private readonly modules: ModuleStore,
  ) {}

  async config(guildId: string): Promise<CardsConfig> {
    return this.modules.get(guildId, MODULE, cardsConfig);
  }

  async forGuild(guildId: string | null): Promise<CardStyle> {
    if (!guildId) return makeStyle(null);
    const cached = this.#cache.get(guildId);
    if (cached && Date.now() - cached.at < TTL) return cached.style;

    const config = await this.config(guildId);
    let style = makeStyle(config.accent);
    if (config.background === 'plain') style = makeStyle(config.accent, { kind: 'plain' });
    if (config.background === 'image') {
      const image = await this.#image(guildId);
      if (image) style = makeStyle(config.accent, { kind: 'image', image, dim: config.dim });
    }
    this.#cache.set(guildId, { style, at: Date.now() });
    return style;
  }

  async setAccent(guildId: string, input: string | null, actor: Actor): Promise<AccentResult> {
    if (input === null) {
      await this.#update(guildId, { accent: null }, actor);
      return { ok: true, accent: null };
    }
    const hex = `#${input.replace(/^#/, '')}`.toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(hex)) return { ok: false, reason: 'format' };
    if (!readableOnDark(hex)) return { ok: false, reason: 'contrast' };
    await this.#update(guildId, { accent: hex }, actor);
    return { ok: true, accent: hex };
  }

  async setBackground(guildId: string, background: 'field' | 'plain', actor: Actor): Promise<void> {
    await this.#update(guildId, { background }, actor);
  }

  async setDim(guildId: string, dim: number, actor: Actor): Promise<void> {
    await this.#update(guildId, { dim: Math.min(Math.max(dim, 0), 0.9) }, actor);
  }

  async importBackground(guildId: string, url: string, actor: Actor): Promise<ImageResult> {
    const bytes = await download(url);
    if (!bytes) return { ok: false, reason: 'source' };
    return this.uploadBackground(guildId, bytes, actor);
  }

  async uploadBackground(guildId: string, bytes: Uint8Array, actor: Actor): Promise<ImageResult> {
    if (bytes.byteLength > MAX_BYTES) return { ok: false, reason: 'format' };
    let source: Image;
    try {
      source = await loadImage(Buffer.from(bytes));
    } catch {
      return { ok: false, reason: 'decode' };
    }

    const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
    const canvas = createCanvas(
      Math.round(source.width * scale),
      Math.round(source.height * scale),
    );
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    const data = await canvas.encode('jpeg', 88);

    await this.sql.begin(async (tx) => {
      await tx`insert into guilds (id) values (${guildId}) on conflict (id) do nothing`;
      await tx`
        insert into guild_assets (guild_id, key, content_type, data)
        values (${guildId}, ${IMAGE_KEY}, 'image/jpeg', ${data})
        on conflict (guild_id, key) do update
          set data = excluded.data, content_type = excluded.content_type, updated_at = now()
      `;
    });
    await this.#update(guildId, { background: 'image' }, actor);
    return { ok: true };
  }

  invalidate(guildId: string): void {
    this.#cache.delete(guildId);
  }

  async #update(guildId: string, patch: Partial<CardsConfig>, actor: Actor): Promise<void> {
    await this.modules.update(guildId, MODULE, patch, actor);
    this.#cache.delete(guildId);
  }

  async #image(guildId: string): Promise<Image | null> {
    const [row] = await this.sql<{ data: Buffer }[]>`
      select data from guild_assets where guild_id = ${guildId} and key = ${IMAGE_KEY}
    `;
    return row ? loadImage(row.data) : null;
  }
}

async function download(url: string): Promise<Uint8Array | null> {
  if (!(await isPublicHttps(url))) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok) return null;
    const type = response.headers.get('content-type') ?? '';
    if (!/^image\/(png|jpeg|webp|gif)/.test(type)) return null;
    if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength > MAX_BYTES ? null : bytes;
  } catch {
    return null;
  }
}
