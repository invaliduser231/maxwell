import { type DigestAction, digestActions } from '@maxwell/core/modules/insights';
import { createCanvas } from '@napi-rs/canvas';
import { locale } from '../i18n/language.js';
import { cardCopy } from './copy.js';
import { backdrop, type Ctx, fitText, roundRect, text, withAlpha } from './draw.js';
import { type CardStyle, defaultStyle, fonts, registerFonts, type Theme } from './theme.js';

export interface DigestTotals {
  joins: number;
  leaves: number;
  messages: number;
  active: number;
  moderation: Record<DigestAction, number>;
}

export interface DigestCard {
  community: string;
  from: Date;
  to: Date;
  current: DigestTotals;
  previous: DigestTotals | null;
  inbox: number;
  channels: { name: string | null; count: number }[];
  style?: CardStyle;
}

type Mood = 'good' | 'bad' | 'neutral';

interface Tile {
  label: string;
  value: string;
  delta: { text: string; mood: Mood } | null;
}

const W = 1000;
const H = 720;
const PAD = 32;
const GAP = 16;
const TILE_W = (W - PAD * 2 - GAP * 2) / 3;
const TILE_H = 132;
const PANEL_W = (W - PAD * 2 - GAP) / 2;
const PANEL_H = 236;
const GOOD = '#2EB67D';
const BAD = '#EC5B78';

function moodColor(mood: Mood, theme: Theme): string {
  return mood === 'good' ? GOOD : mood === 'bad' ? BAD : theme.muted;
}

function total(moderation: Record<DigestAction, number>): number {
  return digestActions.reduce((sum, action) => sum + moderation[action], 0);
}

function surface(ctx: Ctx, x: number, y: number, w: number, h: number, theme: Theme): void {
  roundRect(ctx, x, y, w, h, 20);
  ctx.fillStyle = theme.surface;
  ctx.fill();
}

export async function renderDigest(card: DigestCard): Promise<Buffer> {
  registerFonts();
  const style = card.style ?? defaultStyle;
  const { theme } = style;
  const copy = cardCopy.digest;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const n = new Intl.NumberFormat(locale());
  const sign = new Intl.NumberFormat(locale(), { signDisplay: 'exceptZero' });
  const percentOf = new Intl.NumberFormat(locale(), {
    style: 'percent',
    signDisplay: 'exceptZero',
  });
  const signed = (value: number) => sign.format(value);
  const day = new Intl.DateTimeFormat(locale(), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

  const delta = (
    now: number,
    before: number | undefined,
    upIs: Mood,
    percent = false,
  ): Tile['delta'] => {
    if (before === undefined) return null;
    const change = now - before;
    if (change === 0) return { text: copy.same, mood: 'neutral' };
    const mood: Mood =
      upIs === 'neutral' ? 'neutral' : change > 0 === (upIs === 'good') ? 'good' : 'bad';
    const shown =
      percent && before > 0
        ? percentOf.format(Math.round((change / before) * 100) / 100)
        : signed(change);
    return { text: copy.versus(shown), mood };
  };

  backdrop(ctx, W, H, style, {
    glow: { x: 880, y: 40, r: 360, alpha: 0.16 },
    lines: { cx: 880, baseline: 150, radii: [110, 160, 215, 275], start: 0.28 },
  });

  text(ctx, copy.title, 48, 86, `700 48px "${fonts.display}"`, theme.text);
  const last = new Date(card.to.getTime() - 86_400_000);
  const subtitle = fitText(
    ctx,
    `${card.community}, ${copy.range(day.format(card.from), day.format(last))}`,
    W - 96,
    (s) => `500 ${s}px "${fonts.body}"`,
    [24, 20],
  );
  text(ctx, subtitle.text, 48, 124, subtitle.font, theme.muted);

  const { current, previous } = card;
  const net = current.joins - current.leaves;
  const tiles: Tile[] = [
    {
      label: copy.joins,
      value: n.format(current.joins),
      delta: delta(current.joins, previous?.joins, 'good'),
    },
    {
      label: copy.leaves,
      value: n.format(current.leaves),
      delta: delta(current.leaves, previous?.leaves, 'bad'),
    },
    {
      label: copy.net,
      value: signed(net),
      delta: delta(net, previous ? previous.joins - previous.leaves : undefined, 'good'),
    },
    {
      label: copy.messages,
      value: n.format(current.messages),
      delta: delta(current.messages, previous?.messages, 'good', true),
    },
    {
      label: copy.active,
      value: n.format(current.active),
      delta: delta(current.active, previous?.active, 'good', true),
    },
    { label: copy.inbox, value: n.format(card.inbox), delta: null },
  ];

  tiles.forEach((tile, i) => {
    const x = PAD + (i % 3) * (TILE_W + GAP);
    const y = 156 + Math.floor(i / 3) * (TILE_H + GAP);
    surface(ctx, x, y, TILE_W, TILE_H, theme);
    const label = fitText(
      ctx,
      tile.label,
      TILE_W - 48,
      (s) => `500 ${s}px "${fonts.body}"`,
      [20, 18],
    );
    text(ctx, label.text, x + 24, y + 38, label.font, theme.muted);
    const value = fitText(
      ctx,
      tile.value,
      TILE_W - 48,
      (s) => `700 ${s}px "${fonts.display}"`,
      [46, 40, 34],
    );
    text(ctx, value.text, x + 24, y + 90, value.font, theme.text);
    if (tile.delta) {
      const note = fitText(
        ctx,
        tile.delta.text,
        TILE_W - 48,
        (s) => `500 ${s}px "${fonts.body}"`,
        [18, 16],
      );
      text(ctx, note.text, x + 24, y + 116, note.font, moodColor(tile.delta.mood, theme));
    }
  });

  const top = 156 + 2 * (TILE_H + GAP);
  const heading = `600 22px "${fonts.body}"`;

  const left = PAD;
  surface(ctx, left, top, PANEL_W, PANEL_H, theme);
  text(ctx, copy.channels, left + 24, top + 42, heading, theme.text);
  const busiest = card.channels.slice(0, 3);
  const most = Math.max(1, ...busiest.map((channel) => channel.count));
  if (busiest.length === 0) {
    text(ctx, copy.noMessages, left + 24, top + 92, `500 20px "${fonts.body}"`, theme.muted);
  }
  busiest.forEach((channel, i) => {
    const y = top + 88 + i * 50;
    const count = text(
      ctx,
      n.format(channel.count),
      left + PANEL_W - 24,
      y,
      `600 20px "${fonts.display}"`,
      theme.muted,
      'right',
    );
    const name = fitText(
      ctx,
      channel.name ? `#${channel.name}` : copy.deletedChannel,
      PANEL_W - 72 - count,
      (s) => `500 ${s}px "${fonts.body}"`,
      [20, 18],
    );
    text(ctx, name.text, left + 24, y, name.font, channel.name ? theme.text : theme.muted);
    const bar = PANEL_W - 48;
    roundRect(ctx, left + 24, y + 12, bar, 8, 4);
    ctx.fillStyle = theme.track;
    ctx.fill();
    roundRect(ctx, left + 24, y + 12, Math.max(8, (bar * channel.count) / most), 8, 4);
    ctx.fillStyle = i === 0 ? theme.accent : withAlpha(theme.accent, 0.55);
    ctx.fill();
  });

  const right = PAD + PANEL_W + GAP;
  surface(ctx, right, top, PANEL_W, PANEL_H, theme);
  text(ctx, copy.moderation, right + 24, top + 42, heading, theme.text);
  const summary = previous
    ? delta(total(current.moderation), total(previous.moderation), 'neutral')
    : null;
  if (summary) {
    text(
      ctx,
      summary.text,
      right + PANEL_W - 24,
      top + 42,
      `500 18px "${fonts.body}"`,
      theme.muted,
      'right',
    );
  }
  digestActions.forEach((action, i) => {
    const y = top + 90 + i * 40;
    text(ctx, copy[action], right + 24, y, `500 20px "${fonts.body}"`, theme.muted);
    text(
      ctx,
      n.format(current.moderation[action]),
      right + PANEL_W - 24,
      y,
      `700 24px "${fonts.display}"`,
      current.moderation[action] > 0 ? theme.text : theme.muted,
      'right',
    );
  });

  return canvas.encode('png');
}
