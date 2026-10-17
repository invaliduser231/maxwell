import { createCanvas, type Image } from '@napi-rs/canvas';
import {
  type Ctx,
  fieldLines,
  fitText,
  glow,
  roundRect,
  text,
  withAlpha,
} from '../../cards/draw.js';
import { type CardStyle, defaultStyle, fonts, registerFonts } from '../../cards/theme.js';

export interface CardFace {
  number: number;
  name: string;
  deck: string;
  rarity: { name: string; color: string };
  image: Image | null;
}

export const CARD_W = 500;
export const CARD_H = 700;
const ART = { x: 28, y: 28, w: CARD_W - 56, h: 430 };
const GRID_SCALE = 0.6;
const GRID_GAP = 24;
const PER_ROW = 5;

function art(ctx: Ctx, face: CardFace, style: CardStyle): void {
  const { theme } = style;
  ctx.save();
  roundRect(ctx, ART.x, ART.y, ART.w, ART.h, 22);
  ctx.clip();
  if (face.image) {
    const scale = Math.max(ART.w / face.image.width, ART.h / face.image.height);
    const w = face.image.width * scale;
    const h = face.image.height * scale;
    ctx.drawImage(face.image, ART.x + (ART.w - w) / 2, ART.y + (ART.h - h) / 2, w, h);
  } else {
    ctx.fillStyle = theme.track;
    ctx.fillRect(ART.x, ART.y, ART.w, ART.h);
    const initial = [...face.name.trim()][0]?.toUpperCase() ?? '?';
    text(
      ctx,
      initial,
      CARD_W / 2,
      ART.y + ART.h / 2 + 70,
      `700 200px "${fonts.display}"`,
      face.rarity.color,
      'center',
    );
  }
  ctx.restore();
}

export function drawCard(ctx: Ctx, face: CardFace, style: CardStyle): void {
  const { theme } = style;
  const color = face.rarity.color;
  ctx.save();
  roundRect(ctx, 0, 0, CARD_W, CARD_H, 32);
  ctx.fillStyle = theme.background;
  ctx.fill();
  ctx.save();
  ctx.clip();
  glow(ctx, CARD_W / 2, CARD_H * 0.35, 460, color, 0.22);
  fieldLines(ctx, CARD_W / 2, CARD_H + 40, [170, 230, 295, 365], color, 3, 0.28);
  art(ctx, face, style);

  const name = fitText(
    ctx,
    face.name,
    CARD_W - 64,
    (s) => `600 ${s}px "${fonts.body}"`,
    [44, 38, 32, 28],
  );
  text(ctx, name.text, 32, 522, name.font, theme.text);
  const deck = fitText(ctx, face.deck, CARD_W - 64, (s) => `400 ${s}px "${fonts.body}"`, [26, 22]);
  text(ctx, deck.text, 32, 562, deck.font, theme.muted);

  ctx.font = `600 24px "${fonts.body}"`;
  const pill = ctx.measureText(face.rarity.name).width + 40;
  roundRect(ctx, 32, CARD_H - 92, pill, 48, 24);
  ctx.fillStyle = withAlpha(color, 0.16);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
  text(ctx, face.rarity.name, 52, CARD_H - 59, `600 24px "${fonts.body}"`, color);
  text(
    ctx,
    `#${face.number}`,
    CARD_W - 32,
    CARD_H - 59,
    `500 26px "${fonts.display}"`,
    theme.muted,
    'right',
  );
  ctx.restore();

  roundRect(ctx, 3, 3, CARD_W - 6, CARD_H - 6, 30);
  ctx.lineWidth = 6;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

export async function renderCard(face: CardFace, style: CardStyle = defaultStyle): Promise<Buffer> {
  registerFonts();
  const canvas = createCanvas(CARD_W, CARD_H);
  drawCard(canvas.getContext('2d'), face, style);
  return canvas.encode('png');
}

export function gridSize(count: number): { width: number; height: number; columns: number } {
  const columns = Math.max(1, Math.min(count, PER_ROW));
  const rows = Math.max(1, Math.ceil(count / PER_ROW));
  const cw = CARD_W * GRID_SCALE;
  const ch = CARD_H * GRID_SCALE;
  return {
    width: Math.round(GRID_GAP + columns * (cw + GRID_GAP)),
    height: Math.round(GRID_GAP + rows * (ch + GRID_GAP)),
    columns,
  };
}

export async function renderCards(
  faces: readonly CardFace[],
  style: CardStyle = defaultStyle,
): Promise<Buffer> {
  if (faces.length === 1 && faces[0]) return renderCard(faces[0], style);
  registerFonts();
  const { width, height, columns } = gridSize(faces.length);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  faces.forEach((face, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    ctx.save();
    ctx.translate(
      GRID_GAP + column * (CARD_W * GRID_SCALE + GRID_GAP),
      GRID_GAP + row * (CARD_H * GRID_SCALE + GRID_GAP),
    );
    ctx.scale(GRID_SCALE, GRID_SCALE);
    drawCard(ctx, face, style);
    ctx.restore();
  });
  return canvas.encode('png');
}
