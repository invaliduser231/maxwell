import type { Image, SKRSContext2D } from '@napi-rs/canvas';
import { printable } from './glyphs.js';
import type { CardStyle, Theme } from './theme.js';

export interface Field {
  glow: { x: number; y: number; r: number; alpha: number };
  lines: { cx: number; baseline: number; radii: number[]; start: number };
}

export function backdrop(
  ctx: Ctx,
  w: number,
  h: number,
  style: CardStyle,
  field: Field,
  tone = style.theme.accent,
): void {
  background(ctx, w, h, style.theme);
  const { backdrop } = style;
  if (backdrop.kind === 'image') {
    cover(ctx, backdrop.image, w, h);
    ctx.fillStyle = withAlpha(style.theme.background, backdrop.dim);
    ctx.fillRect(0, 0, w, h);
    return;
  }
  glow(ctx, field.glow.x, field.glow.y, field.glow.r, tone, field.glow.alpha);
  if (backdrop.kind === 'field') {
    const { cx, baseline, radii, start } = field.lines;
    fieldLines(ctx, cx, baseline, radii, tone, 4, start);
  }
}

export function cover(ctx: Ctx, image: Image, w: number, h: number): void {
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

export type Ctx = SKRSContext2D;

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function background(ctx: Ctx, w: number, h: number, theme: Theme, radius = 36): void {
  roundRect(ctx, 0, 0, w, h, radius);
  ctx.fillStyle = theme.background;
  ctx.fill();
  ctx.save();
  ctx.clip();
}

export function glow(ctx: Ctx, x: number, y: number, r: number, color: string, alpha = 0.2): void {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
  gradient.addColorStop(0, withAlpha(color, alpha));
  gradient.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

export function fieldLines(
  ctx: Ctx,
  cx: number,
  baseline: number,
  radii: number[],
  color: string,
  width = 4,
  start = 0.5,
): void {
  ctx.lineWidth = width;
  radii.forEach((r, i) => {
    const alpha = start * 0.68 ** i;
    ctx.strokeStyle = withAlpha(color, alpha);
    ctx.beginPath();
    ctx.moveTo(cx - r, baseline + 400);
    ctx.lineTo(cx - r, baseline);
    ctx.arc(cx, baseline, r, Math.PI, 0);
    ctx.lineTo(cx + r, baseline + 400);
    ctx.stroke();
  });
}

export function fadeDown(ctx: Ctx, w: number, from: number, to: number, color: string): void {
  const gradient = ctx.createLinearGradient(0, from, 0, to);
  gradient.addColorStop(0, withAlpha(color, 0));
  gradient.addColorStop(1, withAlpha(color, 0.92));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, from, w, to - from);
}

export function monogram(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  color: string,
  tip: string | null,
): void {
  const s = size / 200;
  ctx.save();
  ctx.translate(x - 100 * s, y - 100 * s);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = 22;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(50, 143);
  ctx.lineTo(50, 93);
  ctx.arc(75, 93, 25, Math.PI, 0);
  ctx.lineTo(100, 143);
  ctx.moveTo(100, 93);
  ctx.arc(125, 93, 25, Math.PI, 0);
  ctx.lineTo(150, 143);
  ctx.stroke();
  if (tip) {
    ctx.fillStyle = tip;
    for (const left of [39, 89, 139]) ctx.fillRect(left, 127, 22, 16);
  }
  ctx.restore();
}

export function avatar(
  ctx: Ctx,
  image: Image,
  x: number,
  y: number,
  size: number,
  ring: string | null,
  ringWidth = 8,
): void {
  if (ring) {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2 + ringWidth, 0, Math.PI * 2);
    ctx.fillStyle = ring;
    ctx.fill();
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(image, x, y, size, size);
  ctx.restore();
}

export function fitText(
  ctx: Ctx,
  value: string,
  maxWidth: number,
  font: (size: number) => string,
  sizes: number[],
): { text: string; font: string } {
  const text = printable(value, font(sizes[0] ?? 24)).text;
  const sized = (size: number) => printable(text, font(size)).font;
  for (const size of sizes) {
    ctx.font = sized(size);
    if (ctx.measureText(text).width <= maxWidth) return { text, font: ctx.font };
  }
  const smallest = sized(sizes.at(-1) ?? 24);
  ctx.font = smallest;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}…`, font: smallest };
}

export function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: 'left' | 'right' | 'center' = 'left',
): number {
  const { text: shown, font: chosen } = printable(value, font);
  ctx.font = chosen;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(shown, x, y);
  return ctx.measureText(shown).width;
}

export function progress(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  theme: Theme,
): void {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = theme.track;
  ctx.fill();
  const filled = Math.max(h, w * Math.min(Math.max(ratio, 0), 1));
  const gradient = ctx.createLinearGradient(x, 0, x + filled, 0);
  gradient.addColorStop(0, shade(theme.accent, -0.12));
  gradient.addColorStop(1, theme.accent);
  roundRect(ctx, x, y, filled, h, h / 2);
  ctx.fillStyle = gradient;
  ctx.fill();
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function shade(hex: string, amount: number): string {
  const [r, g, b] = rgb(hex).map((c) =>
    Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount),
  );
  return `rgb(${r}, ${g}, ${b})`;
}

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
