import { catalog } from '@maxwell/core';
import { localized } from '../i18n/localized.js';
import de from './modules.de.js';
import es from './modules.es.js';

export interface ModuleText {
  name: string;
  description: string;
}

const en: Record<string, ModuleText> = Object.fromEntries(
  catalog.map((definition) => [
    definition.key,
    { name: definition.name, description: definition.description },
  ]),
);

export type ModuleCopy = typeof en;

export const moduleCopy = localized(en, { de, es });

export function moduleText(key: string, fallback: ModuleText): ModuleText {
  const text = moduleCopy[key];
  return text ? { name: text.name, description: text.description } : fallback;
}
