import { locale } from '../../i18n/language.js';
import { andList } from '../../ui/format.js';

const units: [number, Intl.NumberFormatOptions['unit']][] = [
  [365 * 86_400_000, 'year'],
  [7 * 86_400_000, 'week'],
  [86_400_000, 'day'],
  [3_600_000, 'hour'],
  [60_000, 'minute'],
  [1_000, 'second'],
];

export function humanDuration(ms: number): string {
  let left = Math.max(Math.round(ms / 1_000) * 1_000, 1_000);
  const out: string[] = [];
  for (const [size, unit] of units) {
    const value = Math.floor(left / size);
    if (value > 0) {
      out.push(
        new Intl.NumberFormat(locale(), { style: 'unit', unit, unitDisplay: 'long' }).format(value),
      );
      left -= value * size;
    }
    if (out.length === 2) break;
  }
  return andList(out);
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(vars, key) ? (vars[key] ?? '') : match,
  );
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function auditReason(reason: string, moderator: string | null): string {
  const by = moderator ? ` (by ${moderator})` : '';
  return clip(`${reason}${by}`, 500);
}
