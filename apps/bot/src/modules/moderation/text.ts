import { type Language, language } from '../../i18n/language.js';

type Unit = Record<Language, [string, string]>;

const units: [number, Unit][] = [
  [365 * 86_400_000, { en: ['year', 'years'], de: ['Jahr', 'Jahre'], es: ['año', 'años'] }],
  [7 * 86_400_000, { en: ['week', 'weeks'], de: ['Woche', 'Wochen'], es: ['semana', 'semanas'] }],
  [86_400_000, { en: ['day', 'days'], de: ['Tag', 'Tage'], es: ['día', 'días'] }],
  [3_600_000, { en: ['hour', 'hours'], de: ['Stunde', 'Stunden'], es: ['hora', 'horas'] }],
  [60_000, { en: ['minute', 'minutes'], de: ['Minute', 'Minuten'], es: ['minuto', 'minutos'] }],
  [1_000, { en: ['second', 'seconds'], de: ['Sekunde', 'Sekunden'], es: ['segundo', 'segundos'] }],
];

const joiners: Record<Language, string> = { en: ' ', de: ' und ', es: ' y ' };

export function humanDuration(ms: number): string {
  const lang = language();
  let left = Math.max(Math.round(ms / 1_000) * 1_000, 1_000);
  const out: string[] = [];
  for (const [size, names] of units) {
    const value = Math.floor(left / size);
    if (value > 0) {
      const [one, many] = names[lang];
      out.push(`${value} ${value === 1 ? one : many}`);
      left -= value * size;
    }
    if (out.length === 2) break;
  }
  return out.join(joiners[lang]);
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
