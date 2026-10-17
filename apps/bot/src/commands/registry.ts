import type { CommandInfo } from '@maxwell/core';
import type { Token } from './tokenize.js';
import type { Command, Module } from './types.js';

export interface Resolved {
  command: Command;
  module: Module;
  path: string[];
  rest: Token[];
}

export class Registry {
  readonly modules: Module[] = [];
  readonly #lookup = new Map<string, { command: Command; module: Module }>();
  readonly #claims: ((guildId: string, name: string) => Promise<boolean>)[] = [];

  claim(check: (guildId: string, name: string) => Promise<boolean>): void {
    this.#claims.push(check);
  }

  async claimed(guildId: string, name: string): Promise<boolean> {
    for (const check of this.#claims) {
      if (await check(guildId, name.toLowerCase()).catch(() => false)) return true;
    }
    return false;
  }

  has(name: string): boolean {
    return this.#lookup.has(name.toLowerCase());
  }

  add(module: Module): void {
    const entries = module.commands.flatMap((command) =>
      [command.name, ...(command.aliases ?? [])].map(
        (name) => [name.toLowerCase(), command] as const,
      ),
    );
    for (const [key] of entries) {
      if (this.#lookup.has(key)) throw new Error(`duplicate command name: ${key}`);
    }
    for (const [key, command] of entries) this.#lookup.set(key, { command, module });
    this.modules.push(module);
  }

  names(): string[] {
    return [...this.#lookup.entries()]
      .filter(([, entry]) => !entry.command.hidden && !entry.command.ownerOnly)
      .map(([name]) => name);
  }

  resolve(tokens: readonly Token[]): Resolved | null {
    const first = tokens[0];
    if (!first) return null;
    const entry = this.#lookup.get(first.value.toLowerCase());
    if (!entry) return null;

    let command = entry.command;
    const path = [command.name];
    let index = 1;

    while (command.subcommands?.length) {
      const next = tokens[index];
      if (!next) break;
      const sub = findSub(command, next.value);
      if (!sub) break;
      command = sub;
      path.push(sub.name);
      index++;
    }

    return { command, module: entry.module, path, rest: tokens.slice(index) };
  }

  canonicalPath(path: readonly string[]): string[] {
    const [head, ...tail] = path;
    if (!head) return [];
    let command = this.#lookup.get(head.toLowerCase())?.command;
    if (!command) return [...path];
    const names = [command.name];
    for (const name of tail) {
      command = command ? (findSub(command, name) ?? undefined) : undefined;
      if (!command) break;
      names.push(command.name);
    }
    return names;
  }

  find(path: readonly string[]): Command | null {
    const [head, ...tail] = path;
    if (!head) return null;
    let command = this.#lookup.get(head.toLowerCase())?.command;
    for (const name of tail) {
      command = command ? (findSub(command, name) ?? undefined) : undefined;
    }
    return command ?? null;
  }
}

function findSub(command: Command, name: string): Command | null {
  const key = name.toLowerCase();
  return (
    command.subcommands?.find(
      (sub) => sub.name === key || sub.aliases?.some((alias) => alias === key),
    ) ?? null
  );
}

export function commandCatalog(registry: Registry): CommandInfo[] {
  return registry.modules.flatMap((module) =>
    module.commands
      .filter((command) => !command.ownerOnly && !command.hidden)
      .map((command) => ({
        name: command.name,
        aliases: command.aliases ?? [],
        module: module.key,
        description: command.description,
        subcommands: (command.subcommands ?? [])
          .filter((sub) => !sub.hidden)
          .map((sub) => sub.name),
      })),
  );
}
