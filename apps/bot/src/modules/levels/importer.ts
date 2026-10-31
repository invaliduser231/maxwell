import { type LevelCurve, MAX_LEVEL, totalXpForLevel } from '@maxwell/core/modules/levels';
import type { ImportMode, XpEntry } from '@maxwell/core/stores/levels';

export const MAX_IMPORT = 200_000;

const snowflake = /^\d{15,21}$/;

export interface ParsedImport {
  entries: XpEntry[];
  skipped: number;
}

function rows(input: unknown): unknown[] | null {
  if (typeof input === 'string') {
    try {
      return rows(JSON.parse(input));
    } catch {
      return null;
    }
  }
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    for (const key of ['members', 'users', 'entries', 'data']) {
      if (Array.isArray(record[key]) || typeof record[key] === 'string') return rows(record[key]);
    }
  }
  return null;
}

function number(value: unknown): number | null {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0
    ? Math.floor(parsed)
    : null;
}

export function parseImport(input: unknown, curve: LevelCurve): ParsedImport | null {
  const list = rows(input);
  if (!list) return null;
  const seen = new Map<string, number>();
  let skipped = 0;

  for (const item of list.slice(0, MAX_IMPORT)) {
    if (!item || typeof item !== 'object') {
      skipped++;
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = String(record.id ?? record.user_id ?? record.userId ?? '');
    const xp = number(record.xp ?? record.exp ?? record.experience);
    const level = number(record.level ?? record.lvl);
    if (!snowflake.test(id) || (xp === null && level === null)) {
      skipped++;
      continue;
    }
    const total = xp ?? totalXpForLevel(Math.min(level ?? 0, MAX_LEVEL), curve);
    seen.set(id, Math.max(seen.get(id) ?? 0, total));
  }
  skipped += Math.max(0, list.length - MAX_IMPORT);

  return {
    entries: [...seen].map(([userId, xp]) => ({ userId, xp })),
    skipped,
  };
}

export function parseMode(value: unknown): ImportMode {
  return value === 'add' || value === 'max' ? value : 'replace';
}
