import { createCanvas, type Image, loadImage } from '@napi-rs/canvas';
import { fonts, registerFonts, type Theme } from './theme.js';

const cache = new Map<string, Image>();
const LIMIT = 500;

export async function loadAvatar(url: string | null, name: string, theme: Theme): Promise<Image> {
  if (url) {
    const hit = cache.get(url);
    if (hit) return hit;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) {
        const image = await loadImage(Buffer.from(await response.arrayBuffer()));
        if (cache.size >= LIMIT) cache.delete(cache.keys().next().value as string);
        cache.set(url, image);
        return image;
      }
    } catch {}
  }
  return placeholder(name, theme);
}

export async function placeholder(name: string, theme: Theme): Promise<Image> {
  registerFonts();
  const size = 256;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = theme.track;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = theme.accent;
  ctx.font = `700 120px "${fonts.display}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText([...name.trim()][0]?.toUpperCase() ?? '?', size / 2, size / 2 + 6);
  return loadImage(await canvas.encode('png'));
}
