export interface Token {
  value: string;
  rest: string;
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i] ?? '')) i++;
    if (i >= input.length) break;

    const start = i;
    const quote = input[i];
    if (quote === '"' || quote === "'") {
      const end = input.indexOf(quote, i + 1);
      if (end !== -1) {
        tokens.push({ value: input.slice(i + 1, end), rest: input.slice(start).trim() });
        i = end + 1;
        continue;
      }
    }

    while (i < input.length && !/\s/.test(input[i] ?? '')) i++;
    tokens.push({ value: input.slice(start, i), rest: input.slice(start).trim() });
  }

  return tokens;
}
