import { readFileSync } from 'node:fs';

function cmap(font: Buffer): Set<number> {
  const covered = new Set<number>();
  const tables = font.readUInt16BE(4);
  let offset = -1;
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    if (font.toString('latin1', record, record + 4) === 'cmap') {
      offset = font.readUInt32BE(record + 8);
      break;
    }
  }
  if (offset < 0) return covered;

  const subtables = font.readUInt16BE(offset + 2);
  for (let i = 0; i < subtables; i++) {
    const entry = offset + 4 + i * 8;
    const platform = font.readUInt16BE(entry);
    const encoding = font.readUInt16BE(entry + 2);
    if (platform !== 3 && platform !== 0) continue;
    if (platform === 3 && encoding !== 1 && encoding !== 10) continue;
    const table = offset + font.readUInt32BE(entry + 4);
    const format = font.readUInt16BE(table);
    if (format === 4) {
      const segments = font.readUInt16BE(table + 6) / 2;
      const ends = table + 14;
      const starts = ends + segments * 2 + 2;
      for (let s = 0; s < segments; s++) {
        const end = font.readUInt16BE(ends + s * 2);
        const start = font.readUInt16BE(starts + s * 2);
        for (let code = start; code <= end && code !== 0xffff; code++) covered.add(code);
      }
    } else if (format === 12) {
      const groups = font.readUInt32BE(table + 12);
      for (let g = 0; g < groups; g++) {
        const group = table + 16 + g * 12;
        const start = font.readUInt32BE(group);
        const end = font.readUInt32BE(group + 4);
        for (let code = start; code <= end; code++) covered.add(code);
      }
    }
  }
  return covered;
}

const families = new Map<string, Set<number>>();

export function learnGlyphs(family: string, paths: readonly string[]): void {
  const all = families.get(family) ?? new Set<number>();
  for (const path of paths) {
    let font: Buffer;
    try {
      font = readFileSync(path);
    } catch {
      continue;
    }
    for (const code of cmap(font)) all.add(code);
  }
  if (all.size > 0) families.set(family, all);
}

function coverage(font: string): [string, Set<number>] | null {
  for (const entry of families) if (font.includes(entry[0])) return entry;
  return null;
}

function missing(value: string, known: Set<number>): number {
  let count = 0;
  for (const char of value) {
    if (!/\s/u.test(char) && !known.has(char.codePointAt(0) ?? 0)) count += 1;
  }
  return count;
}

const smallCaps: Record<string, string> = {
  ᴀ: 'A',
  ʙ: 'B',
  ᴄ: 'C',
  ᴅ: 'D',
  ᴇ: 'E',
  ꜰ: 'F',
  ɢ: 'G',
  ʜ: 'H',
  ɪ: 'I',
  ᴊ: 'J',
  ᴋ: 'K',
  ʟ: 'L',
  ᴍ: 'M',
  ɴ: 'N',
  ᴏ: 'O',
  ᴘ: 'P',
  ꞯ: 'Q',
  ʀ: 'R',
  ꜱ: 'S',
  ᴛ: 'T',
  ᴜ: 'U',
  ᴠ: 'V',
  ᴡ: 'W',
  ʏ: 'Y',
  ᴢ: 'Z',
};

const edges = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export function printable(value: string, font: string): { text: string; font: string } {
  const own = coverage(font);
  if (!own) return { text: value, font };
  const normal = [...value]
    .map((char) => smallCaps[char] ?? char)
    .join('')
    .normalize('NFKC');
  let [family, known] = own;
  let gaps = missing(normal, known);
  for (const [other, codes] of families) {
    if (gaps === 0) break;
    const left = missing(normal, codes);
    if (left < gaps) {
      [family, known, gaps] = [other, codes, left];
    }
  }
  let out = '';
  for (const char of normal) {
    if (/\s/u.test(char)) out += ' ';
    else if (known.has(char.codePointAt(0) ?? 0)) out += char;
  }
  out = out.replace(/\s+/g, ' ').trim();
  if (gaps > 0 || normal !== value) {
    const trimmed = out.replace(edges, '');
    if (trimmed) out = trimmed;
  }
  return { text: out || '?', font: font.replace(own[0], family) };
}
