import type { z } from 'zod';
import type { Actor, AuditStore } from '../audit/store.js';
import type { Sql } from '../db/sql.js';
import { moduleByKey } from '../modules/catalog.js';

export const CONFIG_CHANNEL = 'maxwell_config';

export interface ModuleState {
  enabled: boolean;
  config: Record<string, unknown>;
}

export class ModuleStore {
  constructor(
    private readonly sql: Sql,
    private readonly audit: AuditStore | null = null,
  ) {}

  async state(guildId: string, key: string): Promise<ModuleState> {
    const [row] = await this.sql<{ enabled: boolean | null; config: Record<string, unknown> }[]>`
      select enabled, config from guild_modules where guild_id = ${guildId} and module = ${key}
    `;
    const definition = moduleByKey(key);
    const fallback = definition ? definition.defaultEnabled || !definition.toggleable : true;
    return { enabled: row?.enabled ?? fallback, config: row?.config ?? {} };
  }

  async get<T extends z.ZodType>(guildId: string, key: string, schema: T): Promise<z.output<T>> {
    const { config } = await this.state(guildId, key);
    const parsed = schema.safeParse(config);
    return parsed.success ? parsed.data : schema.parse({});
  }

  async isEnabled(guildId: string, key: string): Promise<boolean> {
    return (await this.state(guildId, key)).enabled;
  }

  async setEnabled(guildId: string, key: string, enabled: boolean, actor: Actor): Promise<void> {
    const before = await this.state(guildId, key);
    await this.sql.begin(async (tx) => {
      await tx`insert into guilds (id) values (${guildId}) on conflict (id) do nothing`;
      await tx`
        insert into guild_modules (guild_id, module, enabled)
        values (${guildId}, ${key}, ${enabled})
        on conflict (guild_id, module) do update set enabled = excluded.enabled, updated_at = now()
      `;
      await tx`select pg_notify(${CONFIG_CHANNEL}, ${`${guildId}:${key}`})`;
    });
    if (before.enabled === enabled) return;
    const name = moduleByKey(key)?.name ?? key;
    await this.audit?.record({
      guildId,
      actor,
      module: key,
      action: enabled ? 'module.enable' : 'module.disable',
      summary: `${enabled ? 'Turned on' : 'Turned off'} ${name}`,
      before: { enabled: before.enabled },
      after: { enabled },
      undo: { kind: 'module.enabled', payload: { module: key, enabled: before.enabled } },
    });
  }

  async update(
    guildId: string,
    key: string,
    patch: Record<string, unknown>,
    actor: Actor,
    summary?: string,
  ): Promise<void> {
    const before = (await this.state(guildId, key)).config;
    const after = { ...before, ...patch };
    await this.write(guildId, key, after);
    const name = moduleByKey(key)?.name ?? key;
    await this.audit?.record({
      guildId,
      actor,
      module: key,
      action: 'config.update',
      summary: summary ?? `Changed ${name} settings`,
      before: pick(before, Object.keys(patch)),
      after: patch,
      undo: { kind: 'module.config', payload: { module: key, config: before } },
    });
  }

  async replace(guildId: string, key: string, config: Record<string, unknown>): Promise<void> {
    await this.write(guildId, key, config);
  }

  private async write(
    guildId: string,
    key: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`insert into guilds (id) values (${guildId}) on conflict (id) do nothing`;
      await tx`
        insert into guild_modules (guild_id, module, config)
        values (${guildId}, ${key}, ${tx.json(config as never)})
        on conflict (guild_id, module) do update set config = excluded.config, updated_at = now()
      `;
      await tx`select pg_notify(${CONFIG_CHANNEL}, ${`${guildId}:${key}`})`;
    });
  }
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, source[key] ?? null]));
}
