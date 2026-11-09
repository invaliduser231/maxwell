import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { IntlMessageFormat } from 'intl-messageformat';
import { type Language, language, languages, locale } from './language.js';

export type Vars = Record<string, string | number>;
export type Format = (vars?: Vars) => string;

export type Messages<T> = {
  readonly [K in keyof T]: T[K] extends string
    ? Format
    : T[K] extends readonly unknown[]
      ? (vars?: Vars) => string[]
      : Messages<T[K]>;
};

type Plain<T> = T extends string
  ? string
  : T extends readonly string[]
    ? readonly string[]
    : { readonly [K in keyof T]: Plain<T[K]> };

export type Bound<T, B> = {
  readonly [K in keyof T]: K extends keyof B
    ? B[K] extends (...args: never[]) => unknown
      ? B[K]
      : Bound<T[K], B[K]>
    : Plain<T[K]>;
};

type Binders<T> = {
  [K in keyof T]?: T[K] extends string | readonly unknown[]
    ? (...args: never[]) => unknown
    : Binders<T[K]>;
};

type Translations = Partial<Record<Language, unknown>>;

const registered: { en: unknown; translations: Translations }[] = [];
let lookup: Map<string, Partial<Record<Language, string>>> | null = null;

const localesDir = new URL('../locales/', import.meta.url);

const KNOWN_LANGUAGES = new Set<string>(languages);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function at(root: unknown, path: readonly string[]): unknown {
  let node = root;
  for (const key of path) {
    if (!isRecord(node)) return undefined;
    node = node[key];
  }
  return node;
}

function readTranslations(name: string): Translations {
  const found: Translations = {};
  if (!existsSync(localesDir)) return found;
  for (const entry of readdirSync(localesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'en' || !KNOWN_LANGUAGES.has(entry.name)) continue;
    const file = new URL(`${entry.name}/${name}.json`, localesDir);
    if (!existsSync(file)) continue;
    found[entry.name as Language] = JSON.parse(readFileSync(file, 'utf8'));
  }
  return found;
}

function usable(value: unknown, source: unknown): unknown {
  if (typeof source === 'string') return typeof value === 'string' && value !== '' ? value : source;
  if (Array.isArray(source)) {
    const items = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item !== '')
      : [];
    return items.length > 0 ? items : source;
  }
  return value;
}

const NUMERIC_TYPES = new Set([2, 6, 7]);

function numericNames(elements: readonly unknown[], into = new Set<string>()): Set<string> {
  for (const element of elements) {
    if (!isRecord(element)) continue;
    if (NUMERIC_TYPES.has(element.type as number) && typeof element.value === 'string') {
      into.add(element.value);
    }
    if (isRecord(element.options)) {
      for (const option of Object.values(element.options)) {
        if (isRecord(option) && Array.isArray(option.value)) numericNames(option.value, into);
      }
    }
    if (Array.isArray(element.children)) numericNames(element.children, into);
  }
  return into;
}

interface Compiled {
  format: IntlMessageFormat;
  numeric: Set<string>;
}

const compiled = new Map<string, Compiled | null>();

function compile(text: string, lang: Language): Compiled | null {
  const id = `${lang}\u0000${text}`;
  if (compiled.has(id)) return compiled.get(id) ?? null;
  let result: Compiled | null = null;
  try {
    const format = new IntlMessageFormat(text, locale(lang), undefined, { ignoreTag: true });
    result = { format, numeric: numericNames(format.getAst()) };
  } catch {
    result = null;
  }
  compiled.set(id, result);
  return result;
}

function run(entry: Compiled, lang: Language, vars: Vars | undefined): string {
  if (!vars) return String(entry.format.format());
  const values: Vars = {};
  for (const [key, value] of Object.entries(vars)) {
    values[key] =
      typeof value === 'number' && !entry.numeric.has(key)
        ? value.toLocaleString(locale(lang))
        : value;
  }
  return String(entry.format.format(values));
}

export function formatMessage(source: string, text: string, vars?: Vars): string {
  const lang = language();
  const own = text === source || text === '' ? null : compile(text, lang);
  if (own) {
    try {
      return run(own, lang, vars);
    } catch {}
  }
  const fallback = compile(source, lang);
  if (!fallback) return source;
  return run(fallback, lang, vars);
}

export function catalog<T extends object, B extends Binders<T>>(
  name: string,
  en: T,
  bind: (m: Messages<T>) => B,
): Bound<T, B> {
  const translations = readTranslations(name);
  registered.push({ en, translations });
  lookup = null;

  const current = (path: readonly string[]): unknown =>
    usable(at(translations[language()], path), at(en, path));

  const messageViews = new Map<string, object>();
  const messages = (path: readonly string[]): object => {
    const id = path.join('\u0000');
    const known = messageViews.get(id);
    if (known) return known;
    const view = new Proxy(
      {},
      {
        get(_, key) {
          if (typeof key !== 'string') return undefined;
          const next = [...path, key];
          const source = at(en, next);
          if (typeof source === 'string') {
            return (vars?: Vars) => formatMessage(source, current(next) as string, vars);
          }
          if (Array.isArray(source)) {
            return (vars?: Vars) =>
              (current(next) as string[]).map((text, index) =>
                formatMessage(String(source[index] ?? source[0]), text, vars),
              );
          }
          return isRecord(source) ? messages(next) : undefined;
        },
      },
    );
    messageViews.set(id, view);
    return view;
  };

  const binders = bind(messages([]) as Messages<T>);

  const views = new Map<string, object>();
  const view = (path: readonly string[]): object => {
    const id = path.join('\u0000');
    const known = views.get(id);
    if (known) return known;
    const base = at(en, path);
    const proxy = new Proxy(isRecord(base) ? base : {}, {
      get(target, key) {
        if (typeof key !== 'string') return Reflect.get(target, key);
        const next = [...path, key];
        const bound = at(binders, next);
        if (typeof bound === 'function') return bound;
        const source = at(en, next);
        if (isRecord(source)) return view(next);
        return current(next);
      },
    });
    views.set(id, proxy);
    return proxy;
  };

  return view([]) as Bound<T, B>;
}

function collect(
  en: unknown,
  other: unknown,
  lang: Language,
  into: Map<string, Partial<Record<Language, string>>>,
): void {
  if (typeof en === 'string' && typeof other === 'string' && other !== '') {
    const entry = into.get(en) ?? {};
    entry[lang] ??= other;
    into.set(en, entry);
    return;
  }
  if (Array.isArray(en) && Array.isArray(other)) {
    for (const [index, item] of en.entries()) collect(item, other[index], lang, into);
    return;
  }
  if (isRecord(en) && isRecord(other)) {
    for (const key of Object.keys(en)) collect(en[key], other[key], lang, into);
  }
}

export function translate(text: string): string {
  const lang = language();
  if (lang === 'en') return text;
  if (!lookup) {
    lookup = new Map();
    for (const { en, translations } of registered) {
      for (const [code, other] of Object.entries(translations)) {
        collect(en, other, code as Language, lookup);
      }
    }
  }
  return lookup.get(text)?.[lang] ?? text;
}
