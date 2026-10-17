import { createCanvas, type Image } from '@napi-rs/canvas';
import { avatar, backdrop, fadeDown, fitText, text, withAlpha } from './draw.js';
import { type CardStyle, defaultStyle, fonts, registerFonts } from './theme.js';

export interface WelcomeCard {
  kind: 'welcome' | 'goodbye';
  title: string;
  subtitle: string;
  avatar: Image;
  style?: CardStyle;
}

const W = 1000;
const H = 420;

export async function renderWelcome(card: WelcomeCard): Promise<Buffer> {
  registerFonts();
  const style = card.style ?? defaultStyle;
  const { theme } = style;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const welcome = card.kind === 'welcome';
  const tone = welcome ? theme.accent : theme.muted;

  backdrop(
    ctx,
    W,
    H,
    style,
    {
      glow: { x: 500, y: 150, r: 460, alpha: welcome ? 0.22 : 0.12 },
      lines: { cx: 500, baseline: 150, radii: [130, 185, 245, 310, 380, 455], start: 0.42 },
    },
    tone,
  );
  fadeDown(ctx, W, 200, 300, theme.background);
  ctx.fillStyle = withAlpha(theme.background, 0.92);
  ctx.fillRect(0, 300, W, H - 300);

  if (!welcome) ctx.filter = 'grayscale(1)';
  avatar(ctx, card.avatar, 410, 56, 180, tone, 8);
  ctx.filter = 'none';

  const title = fitText(
    ctx,
    card.title,
    880,
    (s) => `700 ${s}px "${fonts.display}"`,
    [60, 52, 44, 38],
  );
  text(ctx, title.text, 500, 320, title.font, theme.text, 'center');
  const subtitle = fitText(ctx, card.subtitle, 880, (s) => `500 ${s}px "${fonts.body}"`, [28, 24]);
  text(ctx, subtitle.text, 500, 366, subtitle.font, theme.muted, 'center');

  return canvas.encode('png');
}
