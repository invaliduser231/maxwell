import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IntlMessageFormat } from 'intl-messageformat';
import { afterEach, describe, expect, it } from 'vitest';
import { formatMessage, translate } from '../src/i18n/catalog.js';
import {
  inGuild,
  language,
  languageOf,
  setLanguageSource,
  withLanguage,
} from '../src/i18n/language.js';
import { copy as levels } from '../src/modules/levels/copy.js';
import { humanDuration } from '../src/modules/moderation/text.js';
import { andList, count, ordinal } from '../src/ui/format.js';
import { moduleSource } from '../src/ui/modules.js';
import { withPageFooter } from '../src/ui/paginator.js';

const locales = join(import.meta.dirname, '..', 'src', 'locales');

function readJson(lang: string, file: string): unknown {
  return JSON.parse(readFileSync(join(locales, lang, file), 'utf8'));
}

function leaves(value: unknown, path = ''): [string, unknown][] {
  if (typeof value === 'string' || Array.isArray(value)) return [[path, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      leaves(item, path ? `${path}.${key}` : key),
    );
  }
  return [[path, value]];
}

function texts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
  return [];
}

function argumentNames(text: string): Set<string> {
  const names = new Set<string>();
  const walk = (elements: readonly unknown[]): void => {
    for (const element of elements) {
      if (!element || typeof element !== 'object') continue;
      const node = element as {
        value?: unknown;
        options?: Record<string, { value: unknown[] }>;
        children?: unknown[];
      };
      if (typeof node.value === 'string' && 'type' in node && node.type !== 0)
        names.add(node.value);
      for (const option of Object.values(node.options ?? {})) walk(option.value);
      if (node.children) walk(node.children);
    }
  };
  walk(new IntlMessageFormat(text, 'en', undefined, { ignoreTag: true }).getAst());
  return names;
}

describe('catalogs', () => {
  it('formats plurals and numbers in the community language', () => {
    expect(levels.pageTooFar(1)).toBe('There is only 1 page.');
    expect(levels.xpValue(12_000)).toBe('12,000 XP');
    withLanguage('de', () => {
      expect(levels.pageTooFar(3)).toBe('Es gibt nur 3 Seiten.');
      expect(levels.xpValue(12_000)).toBe('12.000 XP');
      expect(levels.boardTitle).toBe('Rangliste');
    });
  });

  it('keeps the language through captured objects', () => {
    const variants = levels.noXpSelf;
    withLanguage('de', () =>
      expect(levels.noXpSelf[0]).toBe('Noch keine XP. Schreib erst mal was.'),
    );
    expect(variants[0]).toBe('No XP yet. Say something first.');
  });

  it('falls back to English when a translation is broken', () => {
    withLanguage('de', () => {
      expect(formatMessage('{n} pages', '{n, plural, one {# Seite}', { n: 2 })).toBe('2 pages');
      expect(formatMessage('{n} pages', '', { n: 2 })).toBe('2 pages');
    });
  });

  it('translates known English strings back', () => {
    withLanguage('de', () => {
      expect(translate('Leaderboard')).toBe('Rangliste');
      expect(translate('Unknown text')).toBe('Unknown text');
    });
  });

  it('keeps the English module names in step with core', () => {
    expect(readJson('en', 'modules.json')).toEqual(moduleSource);
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

describe('formats in Spanish', () => {
  it('formats lists, ordinals and durations', () => {
    withLanguage('es', () => {
      expect(andList(['a', 'b', 'c'])).toBe('a, b y c');
      expect(ordinal(3)).toBe('3.º');
      expect(humanDuration(26 * 3_600_000)).toBe('1 día y 2 horas');
    });
  });
});

describe('translation files', () => {
  const sources = readdirSync(join(locales, 'en'));
  const langs = readdirSync(locales).filter((lang) => lang !== 'en');

  for (const file of sources) {
    const english = new Map(leaves(readJson('en', file)));

    it(`en/${file} holds valid messages`, () => {
      for (const [path, value] of english) {
        for (const text of texts(value)) {
          expect(() => argumentNames(text), `${path}: ${text}`).not.toThrow();
        }
      }
    });

    for (const lang of langs) {
      const name = `${lang}/${file}`;
      it(`${name} matches its English source`, () => {
        const problems: string[] = [];
        let translated: unknown;
        try {
          translated = readJson(lang, file);
        } catch {
          return;
        }
        for (const [path, value] of leaves(translated)) {
          const source = english.get(path);
          if (source === undefined) {
            problems.push(`${path}: not in English`);
            continue;
          }
          if (Array.isArray(source) !== Array.isArray(value)) {
            problems.push(`${path}: shape differs`);
            continue;
          }
          const allowed = new Set(texts(source).flatMap((text) => [...argumentNames(text)]));
          for (const text of texts(value)) {
            let names: Set<string>;
            try {
              names = argumentNames(text);
            } catch {
              problems.push(`${path}: broken ICU ${text}`);
              continue;
            }
            for (const arg of names) {
              if (!allowed.has(arg)) problems.push(`${path}: unknown {${arg}}`);
            }
          }
        }
        expect(problems).toEqual([]);
      });
    }
  }
});
