import { language, locale } from '../i18n/language.js';
import { uiCopy } from './copy.js';

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

const lists = new Map<string, Intl.ListFormat>();

function listFormat(type: Intl.ListFormatType): Intl.ListFormat {
  const lang = language() === 'en' ? 'en-GB' : locale();
  const id = `${lang}:${type}`;
  let found = lists.get(id);
  if (!found) {
    found = new Intl.ListFormat(lang, { type });
    lists.set(id, found);
  }
  return found;
}

export function andList(items: readonly string[]): string {
  return listFormat('conjunction').format(items);
}

export function orList(items: readonly string[]): string {
  return listFormat('disjunction').format(items);
}

export function date(value: Date | number, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', ...options }).format(value);
}

export function ordinal(value: number): string {
  return uiCopy.ordinal(value);
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
