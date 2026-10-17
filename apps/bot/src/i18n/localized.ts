import { type Language, language } from './language.js';

export type Translations<T> = Partial<Record<Exclude<Language, 'en'>, T>>;

export interface Catalog {
  en: unknown;
  translations: Translations<unknown>;
}

const SOURCE = Symbol('localized');
const catalogs: Catalog[] = [];
let lookup: Map<string, Partial<Record<Language, string>>> | null = null;

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function at(root: unknown, path: readonly string[]): unknown {
  let node = root;
  for (const key of path) {
    if (!isRecord(node)) return undefined;
    node = node[key];
  }
  return node;
}

export function localized<T extends object>(en: T, translations: Translations<T>): T {
  const roots: Partial<Record<Language, unknown>> = { en, ...translations };
  const views = new Map<string, object>();
  catalogs.push({ en, translations });
  lookup = null;

  const view = (path: readonly string[]): object => {
    const id = path.join('\u0000');
    const known = views.get(id);
    if (known) return known;
    const target = at(en, path);
    const proxy = new Proxy(isRecord(target) ? target : {}, {
      get(base, key) {
        if (key === SOURCE) return path.length === 0 ? { en, translations } : undefined;
        if (typeof key !== 'string') return Reflect.get(base, key);
        const current = at(roots[language()], path);
        let value = isRecord(current) ? current[key] : undefined;
        if (value === undefined) value = base[key];
        return isRecord(value) ? view([...path, key]) : value;
      },
    });
    views.set(id, proxy);
    return proxy;
  };

  return view([]) as T;
}

export function catalogOf(value: unknown): Catalog | null {
  if (value === null || typeof value !== 'object') return null;
  const found = (value as { [SOURCE]?: Catalog })[SOURCE];
  return found ?? null;
}

function collect(
  en: unknown,
  other: unknown,
  lang: Language,
  into: Map<string, Partial<Record<Language, string>>>,
): void {
  if (typeof en === 'string' && typeof other === 'string') {
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
    for (const catalog of catalogs) {
      for (const [code, other] of Object.entries(catalog.translations)) {
        collect(catalog.en, other, code as Language, lookup);
      }
    }
  }
  return lookup.get(text)?.[lang] ?? text;
}
