import { createCanvas } from '@napi-rs/canvas';
import { locale } from '../i18n/language.js';
import { cardCopy } from './copy.js';
import { backdrop, type Ctx, fitText, roundRect, text, withAlpha } from './draw.js';
import { type CardStyle, defaultStyle, fonts, registerFonts, type Theme } from './theme.js';

export interface ActivityDay {
  day: string;
  messages: number;
  joins: number;
  leaves: number;
}

export interface ActivityCard {
  community: string;
  days: ActivityDay[];
  messages: number;
  active: number;
  joins: number;
  leaves: number;
  voiceMinutes: number;
  style?: CardStyle;
}

const W = 1000;
const H = 760;
const PAD = 32;
const GAP = 16;
const TILE_W = (W - PAD * 2 - GAP * 3) / 4;
const TILE_H = 116;
const PANEL_W = W - PAD * 2;
const PANEL_H = 214;
const GOOD = '#2EB67D';
const BAD = '#EC5B78';

export function fillDays(
  from: string,
  count: number,
  messages: readonly { at: string; messages: number }[],
  flow: readonly { day: string; joins: number; leaves: number }[],
): ActivityDay[] {
  const byMessages = new Map(messages.map((row) => [row.at, row.messages]));
  const byFlow = new Map(flow.map((row) => [row.day, row]));
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const moved = byFlow.get(day);
    return {
      day,
      messages: byMessages.get(day) ?? 0,
      joins: moved?.joins ?? 0,
      leaves: moved?.leaves ?? 0,
    };
  });
}

function surface(ctx: Ctx, x: number, y: number, w: number, h: number, theme: Theme): void {
  roundRect(ctx, x, y, w, h, 20);
  ctx.fillStyle = theme.surface;
  ctx.fill();
}

function bars(
  ctx: Ctx,
  values: readonly number[],
  box: { x: number; y: number; w: number; h: number },
  color: string,
  max: number,
  down = false,
): void {
  if (values.length === 0) return;
  const slot = box.w / values.length;
  const width = Math.max(2, slot * 0.64);
  values.forEach((value, i) => {
    if (value <= 0) return;
    const height = Math.max(3, (box.h * value) / Math.max(1, max));
    const x = box.x + i * slot + (slot - width) / 2;
    const y = down ? box.y : box.y + box.h - height;
    roundRect(ctx, x, y, width, height, Math.min(4, width / 2));
    ctx.fillStyle = color;
    ctx.fill();
  });
}

export async function renderActivity(card: ActivityCard): Promise<Buffer> {
  registerFonts();
  const style = card.style ?? defaultStyle;
  const { theme } = style;
  const copy = cardCopy.activity;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const n = new Intl.NumberFormat(locale());
  const signed = new Intl.NumberFormat(locale(), { signDisplay: 'exceptZero' });
  const day = new Intl.DateTimeFormat(locale(), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const first = card.days[0]?.day;
  const last = card.days.at(-1)?.day;

  backdrop(ctx, W, H, style, {
    glow: { x: 880, y: 40, r: 360, alpha: 0.16 },
    lines: { cx: 880, baseline: 150, radii: [110, 160, 215, 275], start: 0.28 },
  });

  text(ctx, copy.title(card.days.length), 48, 86, `700 48px "${fonts.display}"`, theme.text);
  const range =
    first && last
      ? copy.range(
          day.format(new Date(`${first}T00:00:00Z`)),
          day.format(new Date(`${last}T00:00:00Z`)),
        )
      : '';
  const subtitle = fitText(
    ctx,
    range ? `${card.community}, ${range}` : card.community,
    W - 96,
    (s) => `500 ${s}px "${fonts.body}"`,
    [24, 20],
  );
  text(ctx, subtitle.text, 48, 124, subtitle.font, theme.muted);

  const net = card.joins - card.leaves;
  const tiles = [
    { label: copy.messages, value: n.format(card.messages), color: theme.text },
    { label: copy.active, value: n.format(card.active), color: theme.text },
    {
      label: copy.members,
      value: signed.format(net),
      color: net > 0 ? GOOD : net < 0 ? BAD : theme.text,
    },
    { label: copy.voice, value: n.format(Math.round(card.voiceMinutes / 60)), color: theme.text },
  ];
  tiles.forEach((tile, i) => {
    const x = PAD + i * (TILE_W + GAP);
    const y = 156;
    surface(ctx, x, y, TILE_W, TILE_H, theme);
    const label = fitText(
      ctx,
      tile.label,
      TILE_W - 40,
      (s) => `500 ${s}px "${fonts.body}"`,
      [19, 16],
    );
    text(ctx, label.text, x + 20, y + 36, label.font, theme.muted);
    const value = fitText(
      ctx,
      tile.value,
      TILE_W - 40,
      (s) => `700 ${s}px "${fonts.display}"`,
      [42, 36, 30],
    );
    text(ctx, value.text, x + 20, y + 92, value.font, tile.color);
  });

  const heading = `600 22px "${fonts.body}"`;
  const small = `500 16px "${fonts.body}"`;

  const top1 = 156 + TILE_H + GAP;
  surface(ctx, PAD, top1, PANEL_W, PANEL_H, theme);
  text(ctx, copy.perDay, PAD + 24, top1 + 40, heading, theme.text);
  const busiest = Math.max(0, ...card.days.map((entry) => entry.messages));
  text(ctx, copy.peak(n.format(busiest)), W - PAD - 24, top1 + 40, small, theme.muted, 'right');
  bars(
    ctx,
    card.days.map((entry) => entry.messages),
    { x: PAD + 24, y: top1 + 64, w: PANEL_W - 48, h: PANEL_H - 88 },
    theme.accent,
    busiest,
  );
  if (busiest === 0) {
    text(ctx, copy.empty, PAD + 24, top1 + 130, `500 20px "${fonts.body}"`, theme.muted);
  }

  const top2 = top1 + PANEL_H + GAP;
  surface(ctx, PAD, top2, PANEL_W, PANEL_H, theme);
  text(ctx, copy.flow, PAD + 24, top2 + 40, heading, theme.text);
  const legend = `${copy.joined(n.format(card.joins))}   ${copy.left(n.format(card.leaves))}`;
  text(ctx, legend, W - PAD - 24, top2 + 40, small, theme.muted, 'right');
  const most = Math.max(1, ...card.days.flatMap((entry) => [entry.joins, entry.leaves]));
  const middle = top2 + 64 + (PANEL_H - 88) / 2;
  const half = (PANEL_H - 88) / 2 - 2;
  ctx.fillStyle = withAlpha(theme.muted, 0.25);
  ctx.fillRect(PAD + 24, middle, PANEL_W - 48, 1);
  bars(
    ctx,
    card.days.map((entry) => entry.joins),
    { x: PAD + 24, y: middle - 2 - half, w: PANEL_W - 48, h: half },
    GOOD,
    most,
  );
  bars(
    ctx,
    card.days.map((entry) => entry.leaves),
    { x: PAD + 24, y: middle + 3, w: PANEL_W - 48, h: half },
    BAD,
    most,
    true,
  );

  return canvas.encode('png');
}
