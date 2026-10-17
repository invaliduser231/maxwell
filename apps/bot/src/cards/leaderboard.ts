import { createCanvas, type Image } from '@napi-rs/canvas';
import { avatar, backdrop, fitText, roundRect, text, withAlpha } from './draw.js';
import { type CardStyle, defaultStyle, fonts, registerFonts } from './theme.js';

export interface LeaderboardRow {
  rank: number;
  name: string;
  avatar: Image;
  value: string;
  detail?: string;
  highlight?: boolean;
}

export interface LeaderboardCard {
  title: string;
  subtitle: string;
  rows: LeaderboardRow[];
  style?: CardStyle;
}

const W = 1000;
const HEADER = 156;
const ROW = 84;

export async function renderLeaderboard(card: LeaderboardCard): Promise<Buffer> {
  registerFonts();
  const style = card.style ?? defaultStyle;
  const { theme } = style;
  const height = HEADER + card.rows.length * ROW + 28;
  const canvas = createCanvas(W, height);
  const ctx = canvas.getContext('2d');

  backdrop(ctx, W, height, style, {
    glow: { x: 880, y: 40, r: 360, alpha: 0.16 },
    lines: { cx: 880, baseline: 150, radii: [110, 160, 215, 275], start: 0.28 },
  });

  text(ctx, card.title, 48, 86, `700 48px "${fonts.display}"`, theme.text);
  const subtitle = fitText(ctx, card.subtitle, 600, (s) => `500 ${s}px "${fonts.body}"`, [24, 20]);
  text(ctx, subtitle.text, 48, 124, subtitle.font, theme.muted);

  card.rows.forEach((row, i) => {
    const y = HEADER + i * ROW;
    roundRect(ctx, 32, y, W - 64, ROW - 12, 20);
    ctx.fillStyle = theme.surface;
    ctx.fill();
    if (row.highlight) {
      ctx.fillStyle = withAlpha(theme.accent, 0.08);
      ctx.fill();
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const podium = row.rank <= 3;
    text(
      ctx,
      `#${row.rank}`,
      100,
      y + 48,
      `700 30px "${fonts.display}"`,
      podium ? theme.accent : theme.muted,
      'right',
    );
    avatar(ctx, row.avatar, 124, y + 10, 52, null);

    const valueWidth = text(
      ctx,
      row.value,
      W - 60,
      y + 47,
      `700 28px "${fonts.display}"`,
      theme.text,
      'right',
    );
    let right = W - 60 - valueWidth - 18;
    if (row.detail) {
      right -=
        text(ctx, row.detail, right, y + 46, `500 22px "${fonts.body}"`, theme.muted, 'right') + 18;
    }

    const name = fitText(
      ctx,
      row.name,
      right - 200,
      (s) => `600 ${s}px "${fonts.body}"`,
      [28, 24, 22],
    );
    text(ctx, name.text, 196, y + 46, name.font, theme.text);
  });

  return canvas.encode('png');
}
