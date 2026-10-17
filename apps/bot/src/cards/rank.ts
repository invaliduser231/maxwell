import { createCanvas, type Image } from '@napi-rs/canvas';
import { locale } from '../i18n/language.js';
import { cardCopy } from './copy.js';
import { avatar, backdrop, fitText, progress, text } from './draw.js';
import { type CardStyle, defaultStyle, fonts, registerFonts } from './theme.js';

export interface RankCard {
  name: string;
  username: string;
  avatar: Image;
  level: number;
  rank: number;
  xp: number;
  needed: number;
  style?: CardStyle;
}

const W = 1000;
const H = 300;

export async function renderRank(card: RankCard): Promise<Buffer> {
  registerFonts();
  const style = card.style ?? defaultStyle;
  const { theme } = style;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const n = new Intl.NumberFormat(locale());

  backdrop(ctx, W, H, style, {
    glow: { x: 880, y: 300, r: 420, alpha: 0.16 },
    lines: { cx: 880, baseline: 330, radii: [150, 205, 265, 330, 400], start: 0.3 },
  });

  avatar(ctx, card.avatar, 50, 50, 200, theme.accent, 6);

  const label = `500 22px "${fonts.body}"`;
  const value = `700 64px "${fonts.display}"`;
  const level = n.format(card.level);
  const rank = `#${n.format(card.rank)}`;
  ctx.font = value;
  const levelWidth = Math.max(ctx.measureText(level).width, 60);
  const rankWidth = ctx.measureText(rank).width;
  const rankRight = 950 - levelWidth - 44;

  text(ctx, cardCopy.level, 950, 72, label, theme.muted, 'right');
  text(ctx, level, 950, 136, value, theme.accent, 'right');
  text(ctx, cardCopy.rank, rankRight, 72, label, theme.muted, 'right');
  text(ctx, rank, rankRight, 136, value, theme.text, 'right');

  const room = rankRight - rankWidth - 292 - 32;
  const name = fitText(ctx, card.name, room, (s) => `600 ${s}px "${fonts.body}"`, [48, 42, 36, 32]);
  text(ctx, name.text, 292, 112, name.font, theme.text);
  const handle = fitText(
    ctx,
    `@${card.username}`,
    room,
    (s) => `400 ${s}px "${fonts.body}"`,
    [26, 22],
  );
  text(ctx, handle.text, 292, 152, handle.font, theme.muted);

  const ratio = card.needed > 0 ? card.xp / card.needed : 0;
  text(
    ctx,
    `${n.format(card.xp)} / ${n.format(card.needed)} XP`,
    292,
    204,
    `500 24px "${fonts.body}"`,
    theme.muted,
  );
  text(
    ctx,
    `${Math.floor(ratio * 100)}%`,
    950,
    204,
    `500 24px "${fonts.display}"`,
    theme.muted,
    'right',
  );
  progress(ctx, 292, 218, 658, 30, ratio, theme);

  return canvas.encode('png');
}
