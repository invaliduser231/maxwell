import type { messages } from './messages';

export const languages = ['en', 'de', 'es'] as const;
export type Lang = (typeof languages)[number];
export type Key = keyof typeof messages;
export type Vars = Record<string, string | number>;
export type Table = Readonly<Record<string, string>>;

export const LANG_COOKIE = 'mx_lang';

const locales: Record<Lang, string> = { en: 'en-GB', de: 'de-DE', es: 'es-ES' };

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (languages as readonly string[]).includes(value);
}

export function pickLang(header: string | null | undefined): Lang {
  for (const part of (header ?? '').split(',')) {
    const code = part.split(';')[0]?.trim().slice(0, 2).toLowerCase();
    if (isLang(code)) return code;
  }
  return 'en';
}

export interface Translator {
  (key: Key, vars?: Vars): string;
  lang: Lang;
  locale: string;
  raw(text: string, vars?: Vars): string;
  plural(value: number, one: Key, other: Key, vars?: Vars): string;
  count(value: number): string;
  list(items: string[]): string;
}

const numbers = new Map<string, Intl.NumberFormat>();
const rules = new Map<string, Intl.PluralRules>();

function numberFormat(locale: string): Intl.NumberFormat {
  let found = numbers.get(locale);
  if (!found) {
    found = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    numbers.set(locale, found);
  }
  return found;
}

function pluralRules(locale: string): Intl.PluralRules {
  let found = rules.get(locale);
  if (!found) {
    found = new Intl.PluralRules(locale);
    rules.set(locale, found);
  }
  return found;
}

export function createTranslator(lang: Lang, table: Table | null): Translator {
  const locale = locales[lang];
  const count = (value: number) => numberFormat(locale).format(Math.round(value));
  const fill = (text: string, vars?: Vars) =>
    vars
      ? text.replace(/\{(\w+)\}/g, (match, name: string) => {
          const value = vars[name];
          if (value === undefined) return match;
          return typeof value === 'number' ? count(value) : value;
        })
      : text;
  const raw = (text: string, vars?: Vars) => fill(table?.[text] ?? text, vars);
  const t = ((key: Key, vars?: Vars) => raw(key, vars)) as Translator;
  t.lang = lang;
  t.locale = locale;
  t.raw = raw;
  t.count = count;
  t.plural = (value, one, other, vars) =>
    raw(pluralRules(locale).select(value) === 'one' ? one : other, { n: value, ...vars });
  t.list = (items) => {
    if (items.length < 2) return items.join('');
    const last = items[items.length - 1];
    return `${items.slice(0, -1).join(', ')} ${raw('and')} ${last}`;
  };
  return t;
}
