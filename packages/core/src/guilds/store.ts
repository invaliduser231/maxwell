import type { Sql } from '../db/sql.js';
import { CONFIG_CHANNEL } from './modules.js';

export class GuildStore {
  readonly #prefixes = new Map<string, string | null>();

  constructor(
    private readonly sql: Sql,
    private readonly defaultPrefix: string,
  ) {}

  async prefix(guildId: string | null): Promise<string> {
    if (!guildId) return this.defaultPrefix;
    if (!this.#prefixes.has(guildId)) {
      const [row] = await this.sql<{ prefix: string | null }[]>`
        select prefix from guilds where id = ${guildId}
      `;
      this.#prefixes.set(guildId, row?.prefix ?? null);
    }
    return this.#prefixes.get(guildId) ?? this.defaultPrefix;
  }

  async setPrefix(guildId: string, prefix: string | null): Promise<void> {
    await this.sql`
      insert into guilds (id, prefix) values (${guildId}, ${prefix})
      on conflict (id) do update set prefix = excluded.prefix
    `;
    this.#prefixes.set(guildId, prefix);
    await this.sql`select pg_notify(${CONFIG_CHANNEL}, ${`${guildId}:prefix`})`;
  }

  forgetPrefix(guildId: string): void {
    this.#prefixes.delete(guildId);
  }

  async joined(guildId: string): Promise<boolean> {
    const [row] = await this.sql<{ fresh: boolean }[]>`
      with previous as (select left_at from guilds where id = ${guildId})
      insert into guilds (id) values (${guildId})
      on conflict (id) do update set left_at = null
      returning not exists (select 1 from previous)
        or exists (select 1 from previous where left_at is not null) as fresh
    `;
    return row?.fresh ?? false;
  }

  async active(guildId: string): Promise<boolean> {
    const [row] = await this.sql`
      select 1 from guilds where id = ${guildId} and left_at is null
    `;
    return Boolean(row);
  }

  async left(guildId: string): Promise<void> {
    await this.sql`update guilds set left_at = now() where id = ${guildId}`;
    this.#prefixes.delete(guildId);
  }
}
