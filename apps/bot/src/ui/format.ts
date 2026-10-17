import { language, locale } from '../i18n/language.js';

const FLUXER_EPOCH = 1_420_070_400_000n;

export type TimestampStyle = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R';

export function timestamp(date: Date | number, style: TimestampStyle = 'f'): string {
  const ms = typeof date === 'number' ? date : date.getTime();
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

export function snowflakeDate(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + FLUXER_EPOCH));
}

export function count(value: number): string {
  return value.toLocaleString(locale());
}

export function plural(value: number, one: string, many = `${one}s`): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  const and = language() === 'de' ? 'und' : 'and';
  return `${items.slice(0, -1).join(', ')} ${and} ${items.at(-1)}`;
}

export function orList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  const or = language() === 'de' ? 'oder' : 'or';
  return `${items.slice(0, -1).join(', ')} ${or} ${items.at(-1)}`;
}

export function date(value: Date | number, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', ...options }).format(value);
}

export function ordinal(value: number): string {
  if (language() === 'de') return `${value}.`;
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th';
  return `${value}${suffix}`;
}

export function code(text: string): string {
  return `\`${text.replaceAll('`', 'ˋ')}\``;
}

export function bold(text: string): string {
  return `**${escapeMarkdown(text)}**`;
}

export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|])/g, '\\$1');
}

export function subtext(text: string): string {
  return `-# ${text}`;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function lines(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === 'string').join('\n');
}
