import { parseDuration } from './duration.js';
import { channelId, roleId, userId } from './mentions.js';
import type { Token } from './tokenize.js';

export type ArgType = 'word' | 'text' | 'integer' | 'user' | 'channel' | 'role' | 'duration';

export interface ArgSpec {
  name: string;
  type: ArgType;
  optional?: boolean;
  min?: number;
  max?: number;
}

export class Args {
  readonly #values: Map<string, string | number>;

  constructor(values: Map<string, string | number> = new Map()) {
    this.#values = values;
  }

  has(name: string): boolean {
    return this.#values.has(name);
  }

  string(name: string): string | undefined {
    const value = this.#values.get(name);
    return typeof value === 'string' ? value : undefined;
  }

  number(name: string): number | undefined {
    const value = this.#values.get(name);
    return typeof value === 'number' ? value : undefined;
  }
}

export type ParseResult = { ok: true; args: Args } | { ok: false; arg: ArgSpec; missing: boolean };

export function parseArgs(specs: readonly ArgSpec[], tokens: readonly Token[]): ParseResult {
  const values = new Map<string, string | number>();
  let index = 0;

  for (const spec of specs) {
    const token = tokens[index];
    if (!token) {
      if (spec.optional) continue;
      return { ok: false, arg: spec, missing: true };
    }

    const value = spec.type === 'text' ? token.rest : convert(spec, token.value);
    if (value === null) {
      if (spec.optional && spec.type !== 'text') continue;
      return { ok: false, arg: spec, missing: false };
    }

    values.set(spec.name, value);
    index = spec.type === 'text' ? tokens.length : index + 1;
  }

  return { ok: true, args: new Args(values) };
}

function convert(spec: ArgSpec, raw: string): string | number | null {
  switch (spec.type) {
    case 'word':
    case 'text':
      return raw;
    case 'user':
      return userId(raw);
    case 'channel':
      return channelId(raw);
    case 'role':
      return roleId(raw);
    case 'duration':
      return parseDuration(raw);
    case 'integer': {
      if (!/^-?\d+$/.test(raw)) return null;
      const value = Number(raw);
      if (spec.min !== undefined && value < spec.min) return null;
      if (spec.max !== undefined && value > spec.max) return null;
      return value;
    }
  }
}

export function formatArgs(specs: readonly ArgSpec[]): string {
  return specs
    .map((spec) => {
      const label = spec.type === 'text' ? `${spec.name}...` : spec.name;
      return spec.optional ? `[${label}]` : `<${label}>`;
    })
    .join(' ');
}
