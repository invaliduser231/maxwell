import { join } from 'node:path';
import { createCanvas, type Image, loadImage } from '@napi-rs/canvas';
import { backdrop, type Ctx, fitText, roundRect, text, withAlpha } from './draw.js';
import { assetsDir, type CardStyle, defaultStyle, fonts, registerFonts } from './theme.js';

export interface TableHand {
  label: string;
  cards: string[];
  total: number | null;
  note?: string | null;
  active?: boolean;
}

export interface TableView {
  dealer: TableHand;
  hidden: boolean;
  hands: TableHand[];
  status: { text: string; tone: 'play' | 'win' | 'lose' | 'push' };
  style?: CardStyle;
}

const W = 1000;
const CARD_W = 126;
const CARD_H = 176;
const EDGE = 56;
const GAP = 16;
const ROW = 244;
const RED = '#D6455D';
const INK = '#1C1C22';
const PAPER = '#F7F5F0';

const tones = { play: null, win: '#2EB67D', lose: '#DC2F55', push: '#8A8F98' } as const;

function suit(ctx: Ctx, kind: string, x: number, y: number, size: number, color: string): void {
  const s = size;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (kind === 'H') {
    ctx.moveTo(x, y + s * 0.35);
    ctx.bezierCurveTo(x, y - s * 0.05, x - s * 0.55, y - s * 0.05, x - s * 0.55, y + s * 0.3);
    ctx.bezierCurveTo(x - s * 0.55, y + s * 0.6, x - s * 0.15, y + s * 0.75, x, y + s);
    ctx.bezierCurveTo(
      x + s * 0.15,
      y + s * 0.75,
      x + s * 0.55,
      y + s * 0.6,
      x + s * 0.55,
      y + s * 0.3,
    );
    ctx.bezierCurveTo(x + s * 0.55, y - s * 0.05, x, y - s * 0.05, x, y + s * 0.35);
    ctx.fill();
    return;
  }
  if (kind === 'D') {
    ctx.moveTo(x, y);
    ctx.lineTo(x + s * 0.42, y + s * 0.5);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s * 0.42, y + s * 0.5);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (kind === 'S') {
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(
      x + s * 0.15,
      y + s * 0.25,
      x + s * 0.55,
      y + s * 0.35,
      x + s * 0.55,
      y + s * 0.62,
    );
    ctx.bezierCurveTo(
      x + s * 0.55,
      y + s * 0.85,
      x + s * 0.2,
      y + s * 0.9,
      x + s * 0.06,
      y + s * 0.72,
    );
    ctx.lineTo(x + s * 0.16, y + s);
    ctx.lineTo(x - s * 0.16, y + s);
    ctx.lineTo(x - s * 0.06, y + s * 0.72);
    ctx.bezierCurveTo(
      x - s * 0.2,
      y + s * 0.9,
      x - s * 0.55,
      y + s * 0.85,
      x - s * 0.55,
      y + s * 0.62,
    );
    ctx.bezierCurveTo(x - s * 0.55, y + s * 0.35, x - s * 0.15, y + s * 0.25, x, y);
    ctx.fill();
    return;
  }
  const r = s * 0.24;
  ctx.arc(x, y + r, r, 0, Math.PI * 2);
  ctx.moveTo(x - s * 0.26 + r, y + s * 0.52);
  ctx.arc(x - s * 0.26, y + s * 0.52, r, 0, Math.PI * 2);
  ctx.moveTo(x + s * 0.26 + r, y + s * 0.52);
  ctx.arc(x + s * 0.26, y + s * 0.52, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - s * 0.06, y + s * 0.5);
  ctx.lineTo(x - s * 0.16, y + s);
  ctx.lineTo(x + s * 0.16, y + s);
  ctx.lineTo(x + s * 0.06, y + s * 0.5);
  ctx.closePath();
  ctx.fill();
}

const PIPS: Record<string, [number, number][]> = {
  '2': [
    [0.5, 0],
    [0.5, 1],
  ],
  '3': [
    [0.5, 0],
    [0.5, 0.5],
    [0.5, 1],
  ],
  '4': [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  '5': [
    [0, 0],
    [1, 0],
    [0.5, 0.5],
    [0, 1],
    [1, 1],
  ],
  '6': [
    [0, 0],
    [1, 0],
    [0, 0.5],
    [1, 0.5],
    [0, 1],
    [1, 1],
  ],
  '7': [
    [0, 0],
    [1, 0],
    [0.5, 0.25],
    [0, 0.5],
    [1, 0.5],
    [0, 1],
    [1, 1],
  ],
  '8': [
    [0, 0],
    [1, 0],
    [0.5, 0.25],
    [0, 0.5],
    [1, 0.5],
    [0.5, 0.75],
    [0, 1],
    [1, 1],
  ],
  '9': [
    [0, 0],
    [1, 0],
    [0, 1 / 3],
    [1, 1 / 3],
    [0.5, 0.5],
    [0, 2 / 3],
    [1, 2 / 3],
    [0, 1],
    [1, 1],
  ],
  T: [
    [0, 0],
    [1, 0],
    [0.5, 1 / 6],
    [0, 1 / 3],
    [1, 1 / 3],
    [0, 2 / 3],
    [1, 2 / 3],
    [0.5, 5 / 6],
    [0, 1],
    [1, 1],
  ],
};

function corner(ctx: Ctx, rank: string, kind: string, x: number, y: number, color: string): void {
  text(
    ctx,
    rank,
    x,
    y + 26,
    `700 ${rank.length > 1 ? 22 : 26}px "${fonts.display}"`,
    color,
    'center',
  );
  suit(ctx, kind, x, y + 34, 16, color);
}

function paper(ctx: Ctx, x: number, y: number): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, x, y, CARD_W, CARD_H, 12);
  const sheen = ctx.createLinearGradient(x, y, x, y + CARD_H);
  sheen.addColorStop(0, '#FFFFFF');
  sheen.addColorStop(1, PAPER);
  ctx.fillStyle = sheen;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1, 12);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.stroke();
}

const courts = new Map<string, Promise<Image | null>>();

function court(card: string): Promise<Image | null> {
  const key = card.slice(0, 2);
  let image = courts.get(key);
  if (!image) {
    image = loadImage(join(assetsDir, 'png', 'cards', `${key}.png`)).catch(() => null);
    courts.set(key, image);
  }
  return image;
}

function face(ctx: Ctx, card: string, x: number, y: number, art: Image | null): void {
  const code = card[0] ?? '?';
  const rank = code === 'T' ? '10' : code;
  const kind = card[1] ?? 'S';
  const color = kind === 'H' || kind === 'D' ? RED : INK;
  paper(ctx, x, y);
  corner(ctx, rank, kind, x + 14, y + 8, color);
  ctx.save();
  ctx.translate(x + CARD_W, y + CARD_H);
  ctx.rotate(Math.PI);
  corner(ctx, rank, kind, 14, 8, color);
  ctx.restore();

  const left = x + 42;
  const span = CARD_W - 84;
  const top = y + 24;
  const height = CARD_H - 48 - 18;
  const pips = PIPS[code];
  if (pips) {
    for (const [col, row] of pips) {
      const px = left + col * span;
      const py = top + row * height;
      if (row > 0.5) {
        ctx.save();
        ctx.translate(px, py + 18);
        ctx.rotate(Math.PI);
        suit(ctx, kind, 0, 0, 18, color);
        ctx.restore();
      } else {
        suit(ctx, kind, px, py, 18, color);
      }
    }
    return;
  }
  if (code === 'A') {
    suit(ctx, kind, x + CARD_W / 2, y + CARD_H / 2 - 28, 56, color);
    return;
  }
  if (art) {
    const left = x + 27;
    const top = y + 22;
    ctx.drawImage(art, left, top, CARD_W - 54, CARD_H - 44);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#4444FF';
    ctx.strokeRect(left, top, CARD_W - 54, CARD_H - 44);
    return;
  }
  roundRect(ctx, x + 30, y + 22, CARD_W - 60, CARD_H - 44, 6);
  ctx.fillStyle = withAlpha(color, 0.07);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = withAlpha(color, 0.4);
  ctx.stroke();
  text(
    ctx,
    rank,
    x + CARD_W / 2,
    y + CARD_H / 2 + 8,
    `700 48px "${fonts.display}"`,
    color,
    'center',
  );
  suit(ctx, kind, x + CARD_W / 2, y + CARD_H / 2 + 20, 18, color);
}

function back(ctx: Ctx, x: number, y: number, accent: string): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, x, y, CARD_W, CARD_H, 12);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, x + 8, y + 8, CARD_W - 16, CARD_H - 16, 8);
  ctx.clip();
  ctx.strokeStyle = withAlpha('#FFFFFF', 0.35);
  ctx.lineWidth = 3;
  for (const r of [18, 32, 46, 60, 74]) {
    ctx.beginPath();
    ctx.arc(x + CARD_W / 2, y + CARD_H - 12, r, Math.PI, 0);
    ctx.stroke();
  }
  ctx.restore();
}

function pill(ctx: Ctx, value: string, x: number, y: number, color: string, fill: string): number {
  ctx.font = `700 26px "${fonts.display}"`;
  const width = ctx.measureText(value).width + 32;
  roundRect(ctx, x, y - 30, width, 42, 21);
  ctx.fillStyle = fill;
  ctx.fill();
  text(ctx, value, x + 16, y, `700 26px "${fonts.display}"`, color);
  return width;
}

function spread(count: number): number {
  if (count <= 1) return 0;
  return Math.min(CARD_W + GAP, (W - EDGE * 2 - CARD_W) / (count - 1));
}

function row(
  ctx: Ctx,
  hand: TableHand,
  y: number,
  style: CardStyle,
  hidden: boolean,
  dim: boolean,
  art: Map<string, Image | null>,
): void {
  const { theme } = style;
  const label = fitText(ctx, hand.label, 420, (s) => `600 ${s}px "${fonts.body}"`, [28, 24, 20]);
  const labelWidth = text(ctx, label.text, EDGE, y + 30, label.font, theme.muted);
  if (hand.total !== null) {
    pill(
      ctx,
      String(hand.total),
      EDGE + labelWidth + 16,
      y + 32,
      hand.total > 21 ? '#FFFFFF' : theme.text,
      hand.total > 21 ? RED : theme.track,
    );
  }
  if (hand.note) {
    text(ctx, hand.note, W - EDGE, y + 30, `600 24px "${fonts.body}"`, theme.accent, 'right');
  }
  ctx.save();
  if (dim) ctx.globalAlpha = 0.45;
  const step = spread(hand.cards.length);
  hand.cards.forEach((card, i) => {
    const x = EDGE + i * step;
    if (hidden && i === 1) back(ctx, x, y + 52, theme.accent);
    else face(ctx, card, x, y + 52, art.get(card.slice(0, 2)) ?? null);
  });
  ctx.restore();
}

export async function renderTable(view: TableView): Promise<Buffer> {
  registerFonts();
  const style = view.style ?? defaultStyle;
  const { theme } = style;
  const height = 120 + ROW * (1 + view.hands.length) + 20;
  const canvas = createCanvas(W, height);
  const ctx = canvas.getContext('2d');
  backdrop(ctx, W, height, style, {
    glow: { x: 860, y: height + 40, r: 480, alpha: 0.18 },
    lines: { cx: 860, baseline: height - 40, radii: [140, 200, 270, 350], start: 0.3 },
  });

  const art = new Map<string, Image | null>();
  for (const card of [...view.dealer.cards, ...view.hands.flatMap((hand) => hand.cards)]) {
    if ('JQK'.includes(card[0] ?? '')) art.set(card.slice(0, 2), await court(card));
  }
  row(ctx, view.dealer, 40, style, view.hidden, false, art);
  view.hands.forEach((hand, i) => {
    const many = view.hands.length > 1;
    row(
      ctx,
      hand,
      40 + ROW * (i + 1),
      style,
      false,
      many && view.status.tone === 'play' && !hand.active,
      art,
    );
  });

  const tone = tones[view.status.tone];
  ctx.font = `700 28px "${fonts.display}"`;
  const width = ctx.measureText(view.status.text).width + 40;
  const x = W - 56 - width;
  const y = height - 52;
  roundRect(ctx, x, y - 32, width, 48, 24);
  ctx.fillStyle = tone ? withAlpha(tone, 0.18) : withAlpha(theme.accent, 0.16);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = tone ?? theme.accent;
  ctx.stroke();
  text(ctx, view.status.text, x + 20, y + 2, `700 28px "${fonts.display}"`, tone ?? theme.accent);

  return canvas.encode('png');
}
