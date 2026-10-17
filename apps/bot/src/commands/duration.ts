const units: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

export function parseDuration(input: string): number | null {
  const parts = input.toLowerCase().match(/\d+[smhdw]/g);
  if (!parts || parts.join('') !== input.toLowerCase()) return null;

  let total = 0;
  for (const part of parts) {
    const unit = units[part.slice(-1)];
    if (!unit) return null;
    total += Number(part.slice(0, -1)) * unit;
  }
  return total > 0 ? total : null;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const order: [string, number][] = [
    ['d', 86_400],
    ['h', 3_600],
    ['m', 60],
    ['s', 1],
  ];
  const out: string[] = [];
  let left = seconds;
  for (const [label, size] of order) {
    const value = Math.floor(left / size);
    if (value > 0) out.push(`${value}${label}`);
    left -= value * size;
    if (out.length === 2) break;
  }
  return out.join(' ');
}
