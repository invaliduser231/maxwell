export function distance(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

export function suggest(input: string, names: readonly string[]): string | null {
  const word = input.toLowerCase();
  if (word.length < 3) return null;
  const limit = word.length <= 4 ? 1 : 2;
  let best: { name: string; score: number } | null = null;
  for (const name of names) {
    const score = distance(word, name);
    if (score <= limit && (!best || score < best.score)) best = { name, score };
  }
  return best?.name ?? null;
}
