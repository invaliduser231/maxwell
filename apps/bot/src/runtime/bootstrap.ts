import type { ModuleMigrations } from '@maxwell/core';
import type { Command } from '../commands/types.js';
import { botModules } from '../modules/index.js';
import type { Services } from '../services.js';
import { type BotModule, createContext } from './module.js';

export function moduleMigrations(modules: readonly BotModule[] = botModules): ModuleMigrations[] {
  return modules.map((module) => ({
    module: module.definition.key,
    migrations: module.definition.migrations,
  }));
}

export async function loadModules(
  services: Services,
  modules: readonly BotModule[] = botModules,
): Promise<{ shutdown: () => Promise<void> }> {
  const hooks: (() => void | Promise<void>)[] = [];
  for (const module of modules) {
    const { definition } = module;
    const ctx = createContext(definition, services, hooks);
    const extra = (await module.setup?.(ctx)) ?? [];
    const commands: Command[] = [...(module.commands ?? []), ...extra];
    services.registry.add({
      key: definition.key,
      name: definition.name,
      description: definition.description,
      commands,
    });
  }
  return {
    shutdown: async () => {
      for (const hook of hooks.reverse()) {
        await Promise.resolve(hook()).catch((error) =>
          services.log.warn({ err: error }, 'shutdown hook failed'),
        );
      }
    },
  };
}
