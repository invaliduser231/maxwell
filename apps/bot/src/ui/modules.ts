import { catalog as definitions } from '@maxwell/core';
import { catalog } from '../i18n/catalog.js';
import en from '../locales/en/modules.json' with { type: 'json' };

export interface ModuleText {
  name: string;
  description: string;
}

export const moduleSource: Record<string, ModuleText> = Object.fromEntries(
  definitions.map((definition) => [
    definition.key,
    { name: definition.name, description: definition.description },
  ]),
);

export const moduleCopy = catalog('modules', en, () => ({})) as unknown as Record<
  string,
  ModuleText | undefined
>;

export function moduleText(key: string, fallback: ModuleText): ModuleText {
  const text = moduleCopy[key];
  return text ? { name: text.name, description: text.description } : fallback;
}
