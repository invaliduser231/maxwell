import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') || entry.name.endsWith('.json') ? [path] : [];
  });
}

function jsonTexts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(jsonTexts);
  if (value && typeof value === 'object') return Object.values(value).flatMap(jsonTexts);
  return [];
}

function literals(source: string): string[] {
  const text = source
    .split('\n')
    .filter((line) => !/fallback/i.test(line))
    .join('\n');
  return [...text.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((match) => match[2] ?? '');
}

const banned: [string, RegExp][] = [
  ['em or en dash', /[–—]/],
  ['emoji', /\p{Extended_Pictographic}/u],
  ['"Successfully"', /\bsuccessfully\b/i],
  ['"Oops"', /\b(oops|whoops|uh oh)\b/i],
  ['double exclamation', /!!/],
  ['"Please note"', /\bplease note\b/i],
  ['apology filler', /sorry for the inconvenience/i],
  ['middle dot', /[·•]/],
];

const bannedGerman: [string, RegExp][] = [
  ['"Erfolgreich"', /\berfolgreich\b/i],
  ['"Hoppla"', /\b(hoppla|huch|ups)\b/i],
  ['"Bitte beachte"', /\bbitte beachte(n)?\b/i],
  ['apology filler', /\b(leider|entschuldige|entschuldigung|wir bitten um verständnis)\b/i],
  ['formal address', /\b(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer)\b/],
  ['"gerne"', /\bgerne?\b/i],
  ['"einfach nur"', /\beinfach nur\b/i],
];

describe('user-facing copy', () => {
  for (const file of sources(root)) {
    const name = file.slice(root.length + 1);
    const german = /[/]locales[/]de[/]/.test(file);
    const rules = german ? [...banned, ...bannedGerman] : banned;
    it(name, () => {
      const problems: string[] = [];
      const source = readFileSync(file, 'utf8');
      const found = file.endsWith('.json') ? jsonTexts(JSON.parse(source)) : literals(source);
      for (const text of found) {
        for (const [label, pattern] of rules) {
          if (pattern.test(text)) problems.push(`${label}: ${text}`);
        }
      }
      expect(problems).toEqual([]);
    });
  }
});
