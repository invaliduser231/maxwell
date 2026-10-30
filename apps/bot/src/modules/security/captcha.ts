import { randomInt } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { fonts, registerFonts } from '../../cards/theme.js';

export const targetColors = {
  blue: '#3A9EEA',
  yellow: '#F2C53A',
} as const;

export type TargetColor = keyof typeof targetColors;

const neutral = '#8E8C99';

export function decoysFor(color: TargetColor): string[] {
  const other = color === 'blue' ? targetColors.yellow : targetColors.blue;
  return [other, neutral];
}

export interface Captcha {
  code: string;
  color: TargetColor;
  png: Buffer;
}

export interface Glyph {
  char: string;
  target: boolean;
}

export type Random = (max: number) => number;

const secure: Random = (max) => randomInt(max);

export function makeCode(length = 5, random: Random = secure): string {
  return Array.from({ length }, () => String(random(10))).join('');
}

export function layout(code: string, decoyCount: number, random: Random = secure): Glyph[] {
  const glyphs: Glyph[] = [...code].map((char) => ({ char, target: true }));
  for (let i = 0; i < decoyCount; i++) {
    const at = random(glyphs.length + 1);
    glyphs.splice(at, 0, { char: String(random(10)), target: false });
  }
  return glyphs;
}

export function readTargets(glyphs: readonly Glyph[]): string {
  return glyphs
    .filter((glyph) => glyph.target)
    .map((glyph) => glyph.char)
    .join('');
}

export function normalizeAnswer(text: string): string {
  return text.replace(/\D/g, '');
}

export function looksLikeAnswer(content: string): boolean {
  const trimmed = content.trim();
  return /^new$/i.test(trimmed) || /^[\d\s-]{3,20}$/.test(trimmed);
}

export function matches(answer: string, code: string): boolean {
  const clean = normalizeAnswer(answer);
  if (clean.length !== code.length) return false;
  let diff = 0;
  for (let i = 0; i < code.length; i++) diff |= clean.charCodeAt(i) ^ code.charCodeAt(i);
  return diff === 0;
}

const W = 560;
const H = 200;

export async function renderCaptcha(random: Random = secure): Promise<Captcha> {
  registerFonts();
  const code = makeCode(5, random);
  const color: TargetColor = random(2) === 0 ? 'blue' : 'yellow';
  const glyphs = layout(code, 4 + random(3), random);
  const decoys = decoysFor(color);
  const decoy = () => decoys[random(decoys.length)] ?? neutral;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#17171B';
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = decoy();
    ctx.globalAlpha = 0.25 + random(30) / 100;
    ctx.beginPath();
    ctx.arc(random(W), random(H), 1 + random(3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const step = (W - 60) / glyphs.length;
  glyphs.forEach((glyph, index) => {
    const x = 30 + step * index + step / 2 + (random(11) - 5);
    const y = H / 2 + 22 + (random(31) - 15);
    const size = 54 + random(18);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(((random(41) - 20) * Math.PI) / 180);
    ctx.transform(1, 0, (random(21) - 10) / 50, 1, 0, 0);
    ctx.font = `${size}px "${fonts.display}"`;
    ctx.textAlign = 'center';
    ctx.fillStyle = glyph.target ? targetColors[color] : decoy();
    ctx.fillText(glyph.char, 0, 0);
    ctx.restore();
  });

  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = i % 2 === 0 ? decoy() : targetColors[color];
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 2 + random(2);
    ctx.beginPath();
    ctx.moveTo(0, random(H));
    ctx.bezierCurveTo(W / 3, random(H), (2 * W) / 3, random(H), W, random(H));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  return { code: readTargets(glyphs), color, png: await canvas.encode('png') };
}
