import { language } from '../../i18n/language.js';

const units: [number, [string, string], [string, string]][] = [
  [365 * 86_400_000, ['year', 'years'], ['Jahr', 'Jahre']],
  [7 * 86_400_000, ['week', 'weeks'], ['Woche', 'Wochen']],
  [86_400_000, ['day', 'days'], ['Tag', 'Tage']],
  [3_600_000, ['hour', 'hours'], ['Stunde', 'Stunden']],
  [60_000, ['minute', 'minutes'], ['Minute', 'Minuten']],
  [1_000, ['second', 'seconds'], ['Sekunde', 'Sekunden']],
];

export function humanDuration(ms: number): string {
  const german = language() === 'de';
  let left = Math.max(Math.round(ms / 1_000) * 1_000, 1_000);
  const out: string[] = [];
  for (const [size, en, de] of units) {
    const value = Math.floor(left / size);
    if (value > 0) {
      const [one, many] = german ? de : en;
      out.push(`${value} ${value === 1 ? one : many}`);
      left -= value * size;
    }
    if (out.length === 2) break;
  }
  return out.join(german ? ' und ' : ' ');
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
