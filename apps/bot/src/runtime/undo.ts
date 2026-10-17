import {
  type Actor,
  type AuditEntry,
  type AuditStore,
  canUndo,
  type ModuleStore,
} from '@maxwell/core';
import type { Scheduler } from './scheduler.js';

export type UndoHandler = (
  entry: AuditEntry,
  payload: Record<string, unknown>,
  by: Actor,
) => Promise<void>;

export class UndoRegistry {
  readonly #handlers = new Map<string, UndoHandler>();

  constructor(
    private readonly audit: AuditStore,
    modules: ModuleStore,
  ) {
    this.handle('module.config', async (entry, payload) => {
      await modules.replace(
        entry.guildId,
        String(payload.module),
        (payload.config ?? {}) as Record<string, unknown>,
      );
    });
    this.handle('module.enabled', async (entry, payload, by) => {
      await modules.setEnabled(entry.guildId, String(payload.module), payload.enabled === true, by);
    });
  }

  handle(kind: string, handler: UndoHandler): void {
    if (this.#handlers.has(kind)) throw new Error(`duplicate undo handler: ${kind}`);
    this.#handlers.set(kind, handler);
  }

  async undo(
    guildId: string,
    entryId: string,
    by: Actor,
  ): Promise<'done' | 'missing' | 'expired' | 'unsupported'> {
    const entry = await this.audit.get(guildId, entryId);
    if (!entry) return 'missing';
    if (!canUndo(entry)) return 'expired';
    const handler = entry.undo ? this.#handlers.get(entry.undo.kind) : undefined;
    if (!handler || !entry.undo) return 'unsupported';
    await handler(entry, entry.undo.payload, by);
    await this.audit.markUndone(guildId, entryId, by);
    return 'done';
  }

  attach(scheduler: Scheduler): void {
    scheduler.handle('audit.undo', async (job) => {
      const payload = job.payload as { entryId?: string; by?: string | null };
      if (!job.guildId || !payload.entryId) return;
      await this.undo(job.guildId, payload.entryId, { id: payload.by ?? null });
    });
  }
}
