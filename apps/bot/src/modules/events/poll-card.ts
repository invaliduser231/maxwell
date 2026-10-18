import { createCanvas } from '@napi-rs/canvas';
import { backdrop, fitText, roundRect, text, withAlpha } from '../../cards/draw.js';
import { type CardStyle, defaultStyle, fonts, registerFonts } from '../../cards/theme.js';
import { count } from '../../ui/format.js';
import { percentages, winners } from './render.js';

export interface PollCard {
  title: string;
  question: string;
  subtitle: string;
  options: readonly string[];
  counts: readonly number[];
  style?: CardStyle;
}

const W = 1000;
const HEADER = 196;
const ROW = 88;
const PAD = 32;

export async function renderPollCard(card: PollCard): Promise<Buffer> {
  registerFonts();
  const style = card.style ?? defaultStyle;
  const { theme } = style;
  const height = HEADER + card.options.length * ROW + 28;
  const canvas = createCanvas(W, height);
  const ctx = canvas.getContext('2d');

  backdrop(ctx, W, height, style, {
    glow: { x: 880, y: 40, r: 380, alpha: 0.16 },
    lines: { cx: 880, baseline: 170, radii: [110, 160, 215, 275], start: 0.28 },
  });

  text(ctx, card.title, 48, 62, `500 22px "${fonts.body}"`, theme.muted);
  const question = fitText(
    ctx,
    card.question,
    W - 96,
    (s) => `700 ${s}px "${fonts.display}"`,
    [44, 38, 32, 28],
  );
  text(ctx, question.text, 48, 116, question.font, theme.text);
  const subtitle = fitText(
    ctx,
    card.subtitle,
    W - 96,
    (s) => `500 ${s}px "${fonts.body}"`,
    [22, 20],
  );
  text(ctx, subtitle.text, 48, 156, subtitle.font, theme.muted);

  const shares = percentages(card.counts);
  const best = new Set(winners(card.counts));
  const top = Math.max(1, ...card.counts);

  card.options.forEach((option, i) => {
    const y = HEADER + i * ROW;
    const w = W - PAD * 2;
    const h = ROW - 14;
    const votes = card.counts[i] ?? 0;
    const lead = best.has(i);

    roundRect(ctx, PAD, y, w, h, 20);
    ctx.fillStyle = theme.surface;
    ctx.fill();

    if (votes > 0) {
      ctx.save();
      roundRect(ctx, PAD, y, w, h, 20);
      ctx.clip();
      ctx.fillStyle = withAlpha(theme.accent, lead ? 0.34 : 0.14);
      ctx.fillRect(PAD, y, Math.max(h * 0.6, w * (votes / top)), h);
      ctx.restore();
    }
    if (lead) {
      roundRect(ctx, PAD, y, w, h, 20);
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    text(
      ctx,
      String(i + 1),
      PAD + 44,
      y + 48,
      `700 28px "${fonts.display}"`,
      lead ? theme.accent : theme.muted,
      'center',
    );

    const share = `${shares[i] ?? 0}%`;
    const shareWidth = text(
      ctx,
      share,
      W - PAD - 28,
      y + 48,
      `700 28px "${fonts.display}"`,
      theme.text,
      'right',
    );
    const votesLabel = count(votes);
    const votesWidth = text(
      ctx,
      votesLabel,
      W - PAD - 28 - shareWidth - 20,
      y + 47,
      `500 22px "${fonts.body}"`,
      theme.muted,
      'right',
    );

    const right = W - PAD - 28 - shareWidth - 20 - votesWidth - 24;
    const label = fitText(
      ctx,
      option,
      right - (PAD + 84),
      (s) => `600 ${s}px "${fonts.body}"`,
      [28, 24, 22],
    );
    text(ctx, label.text, PAD + 84, y + 47, label.font, theme.text);
  });

  return canvas.encode('png');
}
