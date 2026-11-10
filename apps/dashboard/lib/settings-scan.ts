import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface SettingEntry {
  page: string;
  label: string;
}

const pagesDir = join(import.meta.dirname, '..', 'app', 'g', '[guild]');
export const indexFile = join(import.meta.dirname, 'settings-index.json');

const text = String.raw`(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")`;
const labelled = new RegExp(
  String.raw`<(?:Field|ToggleRow|Panel)\b[^<>]{0,300}?\b(?:label|title)=\{t(?:\.raw)?\(${text}\)\}`,
  'g',
);
const named = /:\s*Record<[^>]+,\s*Key>\s*=\s*\{([^}]*)\}/g;
const value = new RegExp(String.raw`:\s*${text}`, 'g');

function literal(match: RegExpMatchArray): string {
  return (match[1] ?? match[2] ?? '').replace(/\\(.)/g, '$1');
}

function labels(source: string): string[] {
  const found = [...source.matchAll(labelled)].map(literal);
  for (const block of source.matchAll(named)) {
    found.push(...[...(block[1] ?? '').matchAll(value)].map(literal));
  }
  return found;
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

export function scanSettings(): SettingEntry[] {
  const seen = new Set<string>();
  const entries: SettingEntry[] = [];
  for (const file of files(pagesDir).sort()) {
    const parts = relative(pagesDir, file).split(sep);
    const page = parts.length > 1 ? parts[0] : null;
    if (!page) continue;
    for (const label of labels(readFileSync(file, 'utf8'))) {
      if (!label || label.includes('{')) continue;
      const key = `${page}\u0000${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ page, label });
    }
  }
  return entries;
}

export function writeSettingsIndex(): void {
  writeFileSync(indexFile, `${JSON.stringify(scanSettings(), null, 2)}\n`);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) writeSettingsIndex();
