export interface PrivacyHandler {
  export?(guildId: string, userId: string): Promise<Record<string, unknown> | null>;
  forget?(guildId: string, userId: string): Promise<void>;
}

export interface PrivacyFailure {
  module: string;
  error: string;
}

export class PrivacyRegistry {
  readonly #handlers = new Map<string, PrivacyHandler>();

  register(module: string, handler: PrivacyHandler): void {
    if (this.#handlers.has(module)) throw new Error(`duplicate privacy handler: ${module}`);
    this.#handlers.set(module, handler);
  }

  modules(): string[] {
    return [...this.#handlers.keys()];
  }

  async export(
    guildId: string,
    userId: string,
  ): Promise<{ data: Record<string, unknown>; failed: PrivacyFailure[] }> {
    const data: Record<string, unknown> = {};
    const failed: PrivacyFailure[] = [];
    for (const [module, handler] of this.#handlers) {
      if (!handler.export) continue;
      try {
        const part = await handler.export(guildId, userId);
        if (part && Object.keys(part).length > 0) data[module] = part;
      } catch (error) {
        failed.push({ module, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { data, failed };
  }

  async forget(guildId: string, userId: string): Promise<PrivacyFailure[]> {
    const failed: PrivacyFailure[] = [];
    for (const [module, handler] of this.#handlers) {
      if (!handler.forget) continue;
      try {
        await handler.forget(guildId, userId);
      } catch (error) {
        failed.push({ module, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return failed;
  }
}
