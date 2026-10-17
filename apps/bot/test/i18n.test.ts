import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inGuild,
  language,
  languageOf,
  setLanguageSource,
  withLanguage,
} from '../src/i18n/language.js';
import { catalogOf, localized, translate } from '../src/i18n/localized.js';
import { andList, count, ordinal } from '../src/ui/format.js';
import { withPageFooter } from '../src/ui/paginator.js';

const root = join(import.meta.dirname, '..', 'src');

function translationFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return translationFiles(path);
    return entry.name.endsWith('.de.ts') ? [path] : [];
  });
}

function shape(value: unknown, path = ''): string[] {
  if (typeof value === 'function') return [`${path}()`];
  if (Array.isArray(value)) return [`${path}[]`];
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .flatMap((key) => shape((value as Record<string, unknown>)[key], `${path}.${key}`));
  }
  return [path];
}

function sampleCall(fn: (...args: unknown[]) => unknown): unknown {
  const args = Array.from({ length: fn.length }, (_, index) => (index % 2 === 0 ? 'x' : 2));
  try {
    return fn(...args);
  } catch {
    return undefined;
  }
}

describe('localized', () => {
  const sample = localized(
    {
      hello: 'Hello',
      nested: { deep: { word: 'Room' }, greet: (name: string) => `Hi ${name}` },
      list: ['One', 'Two'],
    },
    {
      de: {
        hello: 'Hallo',
        nested: { deep: { word: 'Raum' }, greet: (name: string) => `Hallo ${name}` },
        list: ['Eins', 'Zwei'],
      },
    },
  );

  it('answers in English outside a community', () => {
    expect(sample.hello).toBe('Hello');
    expect(sample.nested.greet('Lena')).toBe('Hi Lena');
  });

  it('switches with the current language, also through captured objects', () => {
    const deep = sample.nested.deep;
    withLanguage('de', () => {
      expect(sample.hello).toBe('Hallo');
      expect(deep.word).toBe('Raum');
      expect(sample.nested.greet('Lena')).toBe('Hallo Lena');
      expect(sample.list).toEqual(['Eins', 'Zwei']);
    });
    expect(deep.word).toBe('Room');
  });

  it('translates known English strings back', () => {
    expect(translate('Hello')).toBe('Hello');
    withLanguage('de', () => {
      expect(translate('Room')).toBe('Raum');
      expect(translate('Unknown text')).toBe('Unknown text');
    });
  });

  it('keeps the language across awaits', async () => {
    await withLanguage('de', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(language()).toBe('de');
    });
  });
});

describe('language source', () => {
  afterEach(() => setLanguageSource(null));

  it('reads the community language and falls back to English', async () => {
    setLanguageSource(async (guildId) => (guildId === '1' ? 'de' : 'en'));
    expect(await languageOf('1')).toBe('de');
    expect(await languageOf('2')).toBe('en');
    expect(await languageOf(null)).toBe('en');
    expect(await inGuild('1', () => language())).toBe('de');
  });

  it('survives a failing source', async () => {
    setLanguageSource(async () => {
      throw new Error('db down');
    });
    expect(await languageOf('1')).toBe('en');
  });
});

describe('formats in German', () => {
  it('formats numbers, lists and ordinals', () => {
    withLanguage('de', () => {
      expect(count(12_000)).toBe('12.000');
      expect(andList(['a', 'b', 'c'])).toBe('a, b und c');
      expect(ordinal(3)).toBe('3.');
      expect(withPageFooter({ title: 'Top' }, 1, 3).footer).toBe('Seite 2 von 3');
    });
  });
});

describe('translation files', () => {
  for (const file of translationFiles(root)) {
    const name = file.slice(root.length + 1);
    it(`${name} matches its English source`, async () => {
      const source = file.replace(/\.de\.ts$/, '.ts');
      const english = (await import(pathToFileURL(source).href)) as Record<string, unknown>;
      const german = ((await import(pathToFileURL(file).href)) as { default: unknown }).default;
      const catalogs = Object.values(english)
        .map(catalogOf)
        .filter((catalog) => catalog !== null);
      const owner = catalogs.find((catalog) => catalog.translations.de === german);
      expect(owner, 'English file must wrap this translation with localized()').toBeDefined();
      if (!owner) return;
      expect(shape(german)).toEqual(shape(owner.en));
    });

    it(`${name} only holds German text`, async () => {
      const german = ((await import(pathToFileURL(file).href)) as { default: unknown }).default;
      const texts: string[] = [];
      const walk = (value: unknown): void => {
        if (typeof value === 'string') texts.push(value);
        else if (typeof value === 'function') {
          const out = sampleCall(value as (...args: unknown[]) => unknown);
          if (typeof out === 'string') texts.push(out);
        } else if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') Object.values(value).forEach(walk);
      };
      walk(german);
      const english = texts.filter((text) =>
        /\b(the|you|your|that|this|with|for|isn't|can't|won't|don't)\b/i.test(
          text.replace(/`[^`]*`/g, ''),
        ),
      );
      expect(english).toEqual([]);
    });
  }
});
