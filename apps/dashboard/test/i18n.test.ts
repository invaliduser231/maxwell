import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createTranslator, pickLang } from '../lib/i18n';
import { messages } from '../lib/i18n/messages';

const dir = join(import.meta.dirname, '..', 'lib', 'i18n', 'de');

async function catalogs(): Promise<[string, Record<string, string>][]> {
  const files = readdirSync(dir).filter((name) => name.endsWith('.ts'));
  return Promise.all(
    files.map(async (name) => {
      const module = (await import(pathToFileURL(join(dir, name)).href)) as Record<
        string,
        Record<string, string>
      >;
      return [name, Object.values(module)[0] ?? {}] as [string, Record<string, string>];
    }),
  );
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
}

describe('german catalog', () => {
  it('keeps the placeholders of every key', () => {
    for (const [key, value] of Object.entries(messages)) {
      assert.deepEqual(placeholders(value), placeholders(key), key);
    }
  });

  it('gives a shared key the same text in every file', async () => {
    const seen = new Map<string, { file: string; value: string }>();
    const clashes: string[] = [];
    for (const [file, table] of await catalogs()) {
      for (const [key, value] of Object.entries(table)) {
        const first = seen.get(key);
        if (!first) seen.set(key, { file, value });
        else if (first.value !== value) {
          clashes.push(`${key}: ${first.file} "${first.value}", ${file} "${value}"`);
        }
      }
    }
    assert.deepEqual(clashes, []);
  });

  it('spreads every file into the table', async () => {
    for (const [file, table] of await catalogs()) {
      for (const key of Object.keys(table)) {
        assert.ok(key in messages, `${key} from ${file}`);
      }
    }
  });

  it('uses no dashes, middle dots or emoji', () => {
    for (const [key, value] of Object.entries(messages)) {
      assert.doesNotMatch(value, /[–—·•]|\p{Extended_Pictographic}/u, key);
      assert.notEqual(value.trim(), '', key);
    }
  });
});

describe('translator', () => {
  it('picks the language from the header', () => {
    assert.equal(pickLang('de-DE,de;q=0.9,en;q=0.8'), 'de');
    assert.equal(pickLang('fr-FR,fr;q=0.9'), 'en');
    assert.equal(pickLang(null), 'en');
  });

  it('fills placeholders and formats numbers', () => {
    const en = createTranslator('en', null);
    const de = createTranslator('de', messages);
    assert.equal(en.plural(1, '{n} member', '{n} members'), '1 member');
    assert.equal(en.plural(1200, '{n} member', '{n} members'), '1,200 members');
    assert.equal(de.plural(1200, '{n} member', '{n} members'), '1.200 Mitglieder');
    assert.equal(de('Page {number}', { number: 3 }), 'Seite 3');
    assert.equal(de.list(['a', 'b', 'c']), 'a, b und c');
  });

  it('falls back to the english text', () => {
    const de = createTranslator('de', messages);
    assert.equal(de.raw('Not a known key.'), 'Not a known key.');
  });
});
