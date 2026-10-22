import 'server-only';
import { moduleByKey } from '@maxwell/core';
import { notFound } from 'next/navigation';
import type { z } from 'zod';
import { type GuildAccess, levelOf, requirePage, voteBlocked } from './access';
import { db } from './db';
import { type Pole, pageByKey } from './pages';

export interface ShellProps {
  module: string;
  title: string;
  pole: Pole;
  initial: Record<string, unknown>;
  enabled: boolean;
  toggleable: boolean;
  readOnly: boolean;
  locked: boolean;
}

export interface LoadedModule<C> {
  access: GuildAccess;
  config: C;
  enabled: boolean;
  shell: ShellProps;
}

export async function loadModule<S extends z.ZodType>(
  guildId: string,
  pageKey: string,
  schema: S,
): Promise<LoadedModule<z.output<S>>> {
  const page = pageByKey(pageKey);
  const key = page?.module;
  const definition = key ? moduleByKey(key) : undefined;
  if (!page || !key || !definition) notFound();
  const access = await requirePage(guildId, pageKey);
  const state = await db().modules.state(guildId, key);
  const parsed = schema.safeParse(state.config);
  const config = (parsed.success ? parsed.data : schema.parse({})) as z.output<S>;
  return {
    access,
    config,
    enabled: state.enabled,
    shell: {
      module: key,
      title: page.name,
      pole: page.pole,
      initial: config as Record<string, unknown>,
      enabled: state.enabled,
      toggleable: definition.toggleable,
      readOnly: levelOf(access, key) !== 'edit',
      locked: voteBlocked(access, key),
    },
  };
}
