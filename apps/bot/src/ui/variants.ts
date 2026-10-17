export function hash(input: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

export class Variants {
  readonly #last = new Map<string, number>();

  pick(key: string, options: readonly string[], seed: string, scope: string): string {
    if (options.length <= 1) return options[0] ?? '';
    const roll = hash(seed) % 100;
    let index = roll < 70 ? 0 : 1 + (roll % (options.length - 1));

    const scoped = `${scope}:${key}`;
    if (this.#last.get(scoped) === index) index = (index + 1) % options.length;
    this.#last.set(scoped, index);
    if (this.#last.size > 10_000) this.#last.clear();

    return options[index] ?? options[0] ?? '';
  }
}
