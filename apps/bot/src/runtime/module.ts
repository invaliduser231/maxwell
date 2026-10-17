import type { Actor, JobInput, ModuleDefinition, UndoSpec } from '@maxwell/core';
import type { z } from 'zod';
import type { Command } from '../commands/types.js';
import { inGuild } from '../i18n/language.js';
import type { PlatformEvents } from '../platform/types.js';
import type { Services } from '../services.js';
import type { PrivacyHandler } from './privacy.js';
import type { JobHandler } from './scheduler.js';
import type { UndoHandler } from './undo.js';

type Payload<K extends keyof PlatformEvents> = Parameters<PlatformEvents[K]>[0];

export interface ModuleContext<C extends z.ZodType = z.ZodType> {
  key: string;
  definition: ModuleDefinition<C>;
  services: Services;
  config(guildId: string): Promise<z.output<C>>;
  enabled(guildId: string): Promise<boolean>;
  update(
    guildId: string,
    patch: Partial<z.output<C>>,
    actor: Actor,
    summary?: string,
  ): Promise<void>;
  on<K extends keyof PlatformEvents>(
    event: K,
    handler: (payload: Payload<K>) => Promise<void> | void,
    options?: { always?: boolean },
  ): void;
  job(kind: string, handler: JobHandler): void;
  schedule(kind: string, input: Omit<JobInput, 'kind'>): Promise<string | null>;
  undo(kind: string, handler: UndoHandler): void;
  privacy(handler: PrivacyHandler): void;
  onShutdown(handler: () => void | Promise<void>): void;
  record(
    guildId: string,
    actor: Actor,
    action: string,
    summary: string,
    extra?: {
      before?: unknown;
      after?: unknown;
      undo?: { kind: string; payload: Record<string, unknown> } | null;
    },
  ): Promise<string>;
}

export interface BotModule<C extends z.ZodType = z.ZodType> {
  definition: ModuleDefinition<C>;
  commands?: Command[];
  setup?(ctx: ModuleContext<C>): undefined | Command[] | Promise<undefined | Command[]>;
}

export function defineBotModule<C extends z.ZodType>(module: BotModule<C>): BotModule<C> {
  return module;
}

function guildOf(payload: unknown): string | null {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object') {
    if ('guildId' in payload && typeof payload.guildId === 'string') return payload.guildId;
    if ('message' in payload && payload.message && typeof payload.message === 'object') {
      const inner = payload.message as { guildId?: unknown };
      if (typeof inner.guildId === 'string') return inner.guildId;
    }
  }
  return null;
}

export function createContext<C extends z.ZodType>(
  definition: ModuleDefinition<C>,
  services: Services,
  shutdown: (() => void | Promise<void>)[] = [],
): ModuleContext<C> {
  const { key } = definition;
  const scoped = (kind: string) => `${key}.${kind}`;
  const ctx: ModuleContext<C> = {
    key,
    definition,
    services,
    config: (guildId) => services.settings.config(guildId, key, definition.config),
    enabled: (guildId) => services.settings.enabled(guildId, key),
    update: (guildId, patch, actor, summary) =>
      services.modules.update(guildId, key, patch as Record<string, unknown>, actor, summary),
    on(event, handler, options) {
      services.platform.on(event, ((payload: Payload<typeof event>) => {
        void (async () => {
          const guildId = guildOf(payload);
          if (guildId && !options?.always && !(await ctx.enabled(guildId))) return;
          await inGuild(guildId, () => handler(payload));
        })().catch((error) =>
          services.log.error({ err: error, module: key, event }, 'module handler failed'),
        );
      }) as PlatformEvents[typeof event]);
    },
    job: (kind, handler) => services.jobs.handle(scoped(kind), handler),
    schedule: (kind, input) => services.jobs.enqueue({ ...input, kind: scoped(kind) }),
    undo: (kind, handler) => services.undo.handle(scoped(kind), handler),
    privacy: (handler) => services.privacy.register(key, handler),
    onShutdown: (handler) => {
      shutdown.push(handler);
    },
    record: (guildId, actor, action, summary, extra = {}) =>
      services.audit.record({
        guildId,
        actor,
        module: key,
        action,
        summary,
        before: extra.before,
        after: extra.after,
        undo: extra.undo
          ? ({ kind: scoped(extra.undo.kind), payload: extra.undo.payload } satisfies UndoSpec)
          : null,
      }),
  };
  return ctx;
}
