import { describe, expect, it } from 'vitest';
import { Registry } from '../src/commands/registry.js';
import { botModules } from '../src/modules/index.js';
import type { ModuleContext } from '../src/runtime/module.js';

function stub(): unknown {
  const fn = () => stub();
  return new Proxy(fn, {
    get: (_target, key) => (key === 'then' ? undefined : stub()),
    apply: () => stub(),
  });
}

function fakeContext(module: (typeof botModules)[number]): ModuleContext {
  return new Proxy(
    {
      key: module.definition.key,
      definition: module.definition,
      config: async () => module.definition.config.parse({}),
    },
    {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : stub()),
    },
  ) as unknown as ModuleContext;
}

describe('command names', () => {
  it('gives every built-in command and alias exactly one owner', async () => {
    const registry = new Registry();
    for (const module of botModules) {
      const commands = (await module.setup?.(fakeContext(module))) ?? [];
      registry.add({
        key: module.definition.key,
        name: module.definition.key,
        description: '',
        commands: [...(module.commands ?? []), ...commands],
      });
    }
    expect(registry.has('lb')).toBe(true);
    expect(registry.primary('levels')).toBe(true);
    expect(registry.primary('lb')).toBe(false);
  });
});
