import { createContext, Script } from 'node:vm';
import {
  type CustomCommand,
  isRiskyRegex,
  PATTERN_MAX,
  validatePattern,
} from '@maxwell/core/modules/commands';

export const INPUT_MAX = 2_000;
const REGEX_TIMEOUT = 25;
const CACHE_SIZE = 2_000;
const STRIKES = 3;
const STRIKE_WINDOW = 60 * 60 * 1000;

export interface Trigger {
  command: CustomCommand;
  args: string;
  match: string[];
}

export interface Invocation {
  name: string;
  args: string;
}

export function invocation(body: string): Invocation | null {
  const trimmed = body.trim();
  const match = /^(\S+)\s*([\s\S]*)$/.exec(trimmed);
  if (!match?.[1]) return null;
  return { name: match[1].toLowerCase(), args: (match[2] ?? '').trim() };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class Matchers {
  readonly #cache = new Map<string, RegExp | null>();
  readonly #strikes = new Map<string, { count: number; since: number }>();
  readonly #script = new Script('result = regex.exec(input)');
  readonly #sandbox = createContext({ regex: null, input: '', result: null });

  constructor(private readonly now: () => number = Date.now) {}

  #compile(key: string, build: () => RegExp | null): RegExp | null {
    if (this.#cache.has(key)) {
      const hit = this.#cache.get(key) ?? null;
      this.#cache.delete(key);
      this.#cache.set(key, hit);
      return hit;
    }
    let value: RegExp | null;
    try {
      value = build();
    } catch {
      value = null;
    }
    this.#cache.set(key, value);
    if (this.#cache.size > CACHE_SIZE) {
      const oldest = this.#cache.keys().next().value;
      if (oldest !== undefined) this.#cache.delete(oldest);
    }
    return value;
  }

  keyword(command: CustomCommand, content: string): string[] | null {
    const pattern = command.pattern.trim();
    if (!pattern) return null;
    const text = command.caseSensitive ? content : content.toLowerCase();
    const needle = command.caseSensitive ? pattern : pattern.toLowerCase();
    switch (command.mode) {
      case 'exact':
        return text.trim() === needle ? [content.trim()] : null;
      case 'startsWith':
        return text.trimStart().startsWith(needle) ? [needle] : null;
      case 'contains':
        return text.includes(needle) ? [needle] : null;
      case 'word': {
        const regex = this.#compile(`w:${command.caseSensitive}:${pattern}`, () => {
          const flags = command.caseSensitive ? 'u' : 'iu';
          return new RegExp(
            `(?<![\\p{L}\\p{N}_])${escapeRegex(pattern)}(?![\\p{L}\\p{N}_])`,
            flags,
          );
        });
        const found = regex?.exec(content);
        return found ? [found[0]] : null;
      }
    }
  }

  blocked(command: CustomCommand): boolean {
    const strike = this.#strikes.get(command.id);
    if (!strike) return false;
    if (this.now() - strike.since > STRIKE_WINDOW) {
      this.#strikes.delete(command.id);
      return false;
    }
    return strike.count >= STRIKES;
  }

  #strike(command: CustomCommand): void {
    const current = this.#strikes.get(command.id);
    const fresh = !current || this.now() - current.since > STRIKE_WINDOW;
    this.#strikes.set(command.id, {
      count: fresh ? 1 : current.count + 1,
      since: fresh ? this.now() : current.since,
    });
    if (this.#strikes.size > CACHE_SIZE) {
      const oldest = this.#strikes.keys().next().value;
      if (oldest !== undefined) this.#strikes.delete(oldest);
    }
  }

  regex(command: CustomCommand, content: string): string[] | null | 'timeout' {
    const pattern = command.pattern.trim();
    if (!pattern || pattern.length > PATTERN_MAX || this.blocked(command)) return null;
    const regex = this.#compile(`r:${command.caseSensitive}:${pattern}`, () => {
      if (validatePattern('regex', pattern) !== null || isRiskyRegex(pattern)) return null;
      return new RegExp(pattern, command.caseSensitive ? 'u' : 'iu');
    });
    if (!regex) return null;
    regex.lastIndex = 0;
    const sandbox = this.#sandbox as { regex: RegExp | null; input: string; result: unknown };
    sandbox.regex = regex;
    sandbox.input = content.slice(0, INPUT_MAX);
    sandbox.result = null;
    try {
      this.#script.runInContext(this.#sandbox, { timeout: REGEX_TIMEOUT });
    } catch (error) {
      if ((error as { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        this.#strike(command);
        return 'timeout';
      }
      return null;
    } finally {
      sandbox.regex = null;
      sandbox.input = '';
    }
    const result = sandbox.result as RegExpExecArray | null;
    sandbox.result = null;
    return result ? [...result].map((part) => part ?? '') : null;
  }
}

export interface FindOptions {
  content: string;
  invoked: Invocation | null;
  matchers: Matchers;
  onTimeout?: (command: CustomCommand) => void;
}

export function findTrigger(
  commands: readonly CustomCommand[],
  options: FindOptions,
): Trigger | null {
  const active = commands.filter((command) => command.enabled && command.pattern.trim());
  const { invoked, content, matchers } = options;

  if (invoked) {
    const command = active.find(
      (entry) => entry.trigger === 'command' && entry.pattern.trim().toLowerCase() === invoked.name,
    );
    if (command) return { command, args: invoked.args, match: [invoked.name] };
  }

  for (const command of active) {
    if (command.trigger !== 'keyword') continue;
    const match = matchers.keyword(command, content);
    if (match) return { command, args: content.trim(), match };
  }

  for (const command of active) {
    if (command.trigger !== 'regex') continue;
    const match = matchers.regex(command, content);
    if (match === 'timeout') {
      options.onTimeout?.(command);
      continue;
    }
    if (match) return { command, args: content.trim(), match };
  }

  return null;
}
