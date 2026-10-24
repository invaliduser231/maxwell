export interface DiffLine {
  sign: '+' | '-' | '';
  text: string;
}

const MAX_LINES = 40;
const MAX_TEXT = 220;

type Plain = Record<string, unknown>;

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stable(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, entry) =>
    isPlain(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
      : entry,
  );
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 3)}...` : text;
}

export function label(key: string): string {
  if (/^\d+$/.test(key)) return key;
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isGrant(value: unknown): value is {
  subjectType: string;
  subjectId: string;
  module: string;
  level: string;
} {
  return isPlain(value) && 'subjectType' in value && 'subjectId' in value && 'level' in value;
}

function format(value: unknown, names: (module: string) => string): string {
  if (value === null || value === undefined) return 'none';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return value.toLocaleString('en-US');
  if (typeof value === 'string') return value === '' ? 'empty' : clip(value.replace(/\s+/g, ' '));
  if (isGrant(value)) {
    const who = value.subjectType === 'role' ? 'Role' : 'Person';
    return `${who} ${value.subjectId}, ${names(String(value.module))}: ${value.level}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return 'none';
    return clip(value.map((item) => format(item, names)).join(', '));
  }
  if (isPlain(value)) {
    const parts = Object.entries(value).map(
      ([key, entry]) =>
        `${label(key)} ${isPlain(entry) || Array.isArray(entry) ? stable(entry) : format(entry, names)}`,
    );
    return clip(parts.join(', '));
  }
  return clip(String(value));
}

function walk(
  before: unknown,
  after: unknown,
  path: string[],
  lines: DiffLine[],
  names: (module: string) => string,
): void {
  if (lines.length > 500) return;
  if (stable(before) === stable(after)) return;
  const prefix = path.length > 0 ? `${path.join(' / ')}: ` : '';
  if (isPlain(before) && isPlain(after) && path.length < 3) {
    const keys = [...new Set([...Object.keys(after), ...Object.keys(before)])];
    for (const key of keys) walk(before[key], after[key], [...path, label(key)], lines, names);
    return;
  }
  if (before === undefined && isPlain(after) && path.length < 3) {
    for (const key of Object.keys(after))
      walk(undefined, after[key], [...path, label(key)], lines, names);
    return;
  }
  if (after === undefined && isPlain(before) && path.length < 3) {
    for (const key of Object.keys(before))
      walk(before[key], undefined, [...path, label(key)], lines, names);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const old = new Map(before.map((item) => [stable(item), item]));
    const next = new Map(after.map((item) => [stable(item), item]));
    const removed = [...old].filter(([key]) => !next.has(key));
    const added = [...next].filter(([key]) => !old.has(key));
    if (removed.length === 0 && added.length === 0) {
      lines.push({ sign: '-', text: `${prefix}${format(before, names)}` });
      lines.push({ sign: '+', text: `${prefix}${format(after, names)}` });
      return;
    }
    for (const [, item] of removed)
      lines.push({ sign: '-', text: `${prefix}${format(item, names)}` });
    for (const [, item] of added)
      lines.push({ sign: '+', text: `${prefix}${format(item, names)}` });
    return;
  }
  if (before !== undefined && before !== null) {
    lines.push({ sign: '-', text: `${prefix}${format(before, names)}` });
  }
  if (after !== undefined) lines.push({ sign: '+', text: `${prefix}${format(after, names)}` });
}

export function diff(
  before: unknown,
  after: unknown,
  names: (module: string) => string,
): DiffLine[] {
  const lines: DiffLine[] = [];
  walk(before ?? undefined, after ?? undefined, [], lines, names);
  if (lines.length > MAX_LINES) {
    const rest = lines.length - MAX_LINES;
    return [...lines.slice(0, MAX_LINES), { sign: '', text: `and ${rest} more` }];
  }
  return lines;
}
