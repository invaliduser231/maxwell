import { copy } from './copy.js';

export function roomName(
  template: string,
  vars: { name: string; username: string; n: number },
): string {
  const values: Record<string, string> = {
    name: vars.name,
    username: vars.username,
    n: String(vars.n),
  };
  const text = template
    .replace(/\{([a-z]+)\}/gi, (match, key: string) => values[key.toLowerCase()] ?? match)
    .replace(/\s+/g, ' ')
    .trim();
  return [...(text || copy.fallbackName)].slice(0, 100).join('');
}

export function cleanName(input: string): string | null {
  const text = input.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return [...text].slice(0, 100).join('');
}

export function nextNumber(taken: readonly number[]): number {
  const used = new Set(taken);
  let n = 1;
  while (used.has(n)) n++;
  return n;
}
