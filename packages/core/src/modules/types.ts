import type { z } from 'zod';

export type Pole = 'north' | 'south' | 'neutral';

export type ModuleGroup = 'order' | 'community' | 'play' | 'tools' | 'settings';

export interface ModuleMigration {
  id: string;
  up: string;
}

export interface ModuleDefinition<C extends z.ZodType = z.ZodType> {
  key: string;
  name: string;
  description: string;
  group: ModuleGroup;
  pole: Pole;
  voteLocked: boolean;
  defaultEnabled: boolean;
  toggleable: boolean;
  config: C;
  migrations: ModuleMigration[];
}

export function defineModule<C extends z.ZodType>(
  definition: ModuleDefinition<C>,
): ModuleDefinition<C> {
  return definition;
}
