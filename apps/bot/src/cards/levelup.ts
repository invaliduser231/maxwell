import { createCanvas, type Image } from '@napi-rs/canvas';
import { cardCopy } from './copy.js';
import { avatar, backdrop, fitText, text } from './draw.js';
import { type CardStyle, defaultStyle, fonts, registerFonts } from './theme.js';

export interface LevelUpCard {
  name: string;
  avatar: Image;
  level: number;
  reward?: { name: string; color?: string };
  mascot?: Image;
  style?: CardStyle;
}

const W = 1000;
const H = 300;

export async function renderLevelUp(card: LevelUpCard): Promise<Buffer> {
  registerFonts();
  const style = card.style ?? defaultStyle;
  const { theme } = style;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  backdrop(ctx, W, H, style, {
    glow: { x: 860, y: 330, r: 440, alpha: 0.2 },
    lines: { cx: 860, baseline: 250, radii: [120, 175, 235, 300, 370], start: 0.35 },
  });

  avatar(ctx, card.avatar, 56, 60, 180, theme.accent, 6);

  const room = card.mascot ? 470 : 650;
  const name = fitText(ctx, card.name, room, (s) => `600 ${s}px "${fonts.body}"`, [36, 32, 28]);
  text(ctx, name.text, 290, 98, name.font, theme.muted);

  const word = text(ctx, cardCopy.levelWord, 290, 196, `700 96px "${fonts.display}"`, theme.text);
  text(ctx, String(card.level), 290 + word, 196, `700 96px "${fonts.display}"`, theme.accent);

  if (card.reward) {
    const lead = text(ctx, cardCopy.unlocked, 292, 248, `400 28px "${fonts.body}"`, theme.muted);
    const reward = fitText(
      ctx,
      card.reward.name,
      room - lead,
      (s) => `600 ${s}px "${fonts.body}"`,
      [28, 24],
    );
    text(ctx, reward.text, 292 + lead, 248, reward.font, card.reward.color ?? theme.text);
  }

  if (card.mascot) ctx.drawImage(card.mascot, 790, 70, 160, 160);

  return canvas.encode('png');
}
