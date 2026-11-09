import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { IntlMessageFormat } from 'intl-messageformat';
import { createTranslator, languages, pickLang, type Table } from '../lib/i18n';
import { areas } from '../lib/i18n/messages';

const root = join(import.meta.dirname, '..', 'locales');

function table(lang: string, area: string): Record<string, string> | null {
  try {
    return JSON.parse(readFileSync(join(root, lang, `${area}.json`), 'utf8'));
  } catch {
    return null;
  }
}

function merged(lang: string): Table {
  return Object.assign({}, ...areas.map((area) => table(lang, area) ?? {}));
}

function argumentNames(text: string): Set<string> {
  const names = new Set<string>();
  const walk = (elements: readonly unknown[]): void => {
    for (const element of elements) {
      if (!element || typeof element !== 'object') continue;
      const node = element as {
        type?: number;
        value?: unknown;
        options?: Record<string, { value: unknown[] }>;
        children?: unknown[];
      };
      if (node.type !== 0 && typeof node.value === 'string') names.add(node.value);
      for (const option of Object.values(node.options ?? {})) walk(option.value);
      if (node.children) walk(node.children);
    }
  };
  walk(new IntlMessageFormat(text, 'en', undefined, { ignoreTag: true }).getAst());
  return names;
}

describe('catalog files', () => {
  it('has a file for every area and nothing else', () => {
    const files = readdirSync(join(root, 'en')).map((name) => name.replace(/\.json$/, ''));
    assert.deepEqual(files.sort(), [...areas].sort());
  });

  it('uses the English text as key and value', () => {
    for (const area of areas) {
      for (const [key, value] of Object.entries(table('en', area) ?? {})) {
        assert.equal(value, key, `${area}: ${key}`);
      }
    }
  });

  for (const lang of languages.filter((code) => code !== 'en')) {
    describe(lang, () => {
      it('only holds keys the English files know', () => {
        for (const area of areas) {
          const english = table('en', area) ?? {};
          for (const key of Object.keys(table(lang, area) ?? {})) {
            assert.ok(key in english, `${area}: ${key}`);
          }
        }
      });

      it('keeps valid messages with known placeholders', () => {
        for (const area of areas) {
          for (const [key, value] of Object.entries(table(lang, area) ?? {})) {
            const allowed = argumentNames(key);
            let names: Set<string>;
            try {
              names = argumentNames(value);
            } catch {
              assert.fail(`${area}: broken message ${value}`);
            }
            for (const name of names)
              assert.ok(allowed.has(name), `${area}: {${name}} in ${value}`);
          }
        }
      });

      it('gives a shared key the same text in every file', () => {
        const seen = new Map<string, { area: string; value: string }>();
        const clashes: string[] = [];
        for (const area of areas) {
          for (const [key, value] of Object.entries(table(lang, area) ?? {})) {
            const first = seen.get(key);
            if (!first) seen.set(key, { area, value });
            else if (first.value !== value) {
              clashes.push(`${key}: ${first.area} "${first.value}", ${area} "${value}"`);
            }
          }
        }
        assert.deepEqual(clashes, []);
      });

      it('uses no dashes, middle dots or emoji', () => {
        for (const [key, value] of Object.entries(merged(lang))) {
          assert.doesNotMatch(value, /[–—·•]|\p{Extended_Pictographic}/u, key);
        }
      });
    });
  }
});

describe('translator', () => {
  it('picks the language from the header', () => {
    assert.equal(pickLang('de-DE,de;q=0.9,en;q=0.8'), 'de');
    assert.equal(pickLang('fr-FR,fr;q=0.9'), 'en');
    assert.equal(pickLang(null), 'en');
  });

  it('fills placeholders, plurals and numbers', () => {
    const en = createTranslator('en', null);
    const de = createTranslator('de', merged('de'));
    const members = '{n, plural, one {# member} other {# members}}';
    assert.equal(en(members, { n: 1 }), '1 member');
    assert.equal(en(members, { n: 1200 }), '1,200 members');
    assert.equal(de(members, { n: 1200 }), '1.200 Mitglieder');
    assert.equal(de('Page {number}', { number: 3 }), 'Seite 3');
    assert.equal(de.list(['a', 'b', 'c']), 'a, b und c');
  });

  it('falls back to the English text', () => {
    const de = createTranslator('de', { 'Page {number}': '', '{n} left': '{n, plural, one {' });
    assert.equal(de.raw('Not a known key.'), 'Not a known key.');
    assert.equal(de.raw('Page {number}', { number: 2 }), 'Page 2');
    assert.equal(de.raw('{n} left', { n: 2 }), '2 left');
  });
});
