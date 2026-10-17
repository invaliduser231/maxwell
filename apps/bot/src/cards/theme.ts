import { join } from 'node:path';
import { GlobalFonts, type Image } from '@napi-rs/canvas';

export const assetsDir = join(import.meta.dirname, '..', '..', '..', '..', 'assets');

export interface Theme {
  accent: string;
  background: string;
  surface: string;
  track: string;
  text: string;
  muted: string;
  tip: string;
}

export const defaultTheme: Theme = {
  accent: '#F26B3A',
  background: '#17171B',
  surface: '#202026',
  track: '#2B2B33',
  text: '#F4F4F2',
  muted: '#8A8F98',
  tip: '#E6E6EA',
};

export type Backdrop =
  | { kind: 'field' }
  | { kind: 'plain' }
  | { kind: 'image'; image: Image; dim: number };

export interface CardStyle {
  theme: Theme;
  backdrop: Backdrop;
}

export const defaultStyle: CardStyle = { theme: defaultTheme, backdrop: { kind: 'field' } };

export function makeStyle(
  accent: string | null,
  backdrop: Backdrop = { kind: 'field' },
): CardStyle {
  return { theme: accent ? { ...defaultTheme, accent } : defaultTheme, backdrop };
}

export function luminance(hex: string): number {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  );
}

export function readableOnDark(hex: string): boolean {
  const contrast = (luminance(hex) + 0.05) / (luminance(defaultTheme.background) + 0.05);
  return contrast >= 3;
}

export const fonts = {
  display: 'Space Grotesk',
  body: 'Inter',
};

let registered = false;

export function registerFonts(dir = join(assetsDir, 'fonts')): void {
  if (registered) return;
  registered = true;
  for (const file of [
    'SpaceGrotesk-Medium.ttf',
    'SpaceGrotesk-Bold.ttf',
    'Inter-Regular.ttf',
    'Inter-Medium.ttf',
    'Inter-SemiBold.ttf',
  ]) {
    GlobalFonts.registerFromPath(join(dir, file));
  }
}
