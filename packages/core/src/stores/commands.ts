import type { Sql } from '../db/sql.js';

export interface CommandUsage {
  commandId: string;
  uses: number;
  lastUsedAt: Date | null;
  lastUserId: string | null;
}

export interface CommandTestResult {
  matched: boolean;
  problem: 'no_match' | 'invalid_pattern' | 'timeout' | 'missing' | 'empty' | 'builtin' | null;
  content: string | null;
  embed: boolean;
  args: string | null;
  addRoles: string[];
  removeRoles: string[];
}

export const TEST_TTL_MINUTES = 60;

export class CommandStore {
  constructor(private readonly sql: Sql) {}

  async used(guildId: string, commandId: string, userId: string): Promise<void> {
    await this.sql`
      insert into commands_usage (guild_id, command_id, uses, last_used_at, last_user_id)
      values (${guildId}, ${commandId}, 1, now(), ${userId})
      on conflict (guild_id, command_id) do update set
        uses = commands_usage.uses + 1, last_used_at = now(), last_user_id = excluded.last_user_id
    `;
  }

  async usage(guildId: string): Promise<CommandUsage[]> {
    return this.sql<CommandUsage[]>`
      select command_id as "commandId", uses, last_used_at as "lastUsedAt",
        last_user_id as "lastUserId"
      from commands_usage where guild_id = ${guildId}
      order by uses desc
    `;
  }

  async lastUsedBy(
    guildId: string,
    userId: string,
  ): Promise<{ commandId: string; lastUsedAt: Date | null }[]> {
    return this.sql<{ commandId: string; lastUsedAt: Date | null }[]>`
      select command_id as "commandId", last_used_at as "lastUsedAt"
      from commands_usage where guild_id = ${guildId} and last_user_id = ${userId}
      order by command_id
    `;
  }

  async forgetUser(guildId: string, userId: string): Promise<void> {
    await this.sql`
      update commands_usage set last_user_id = null
      where guild_id = ${guildId} and last_user_id = ${userId}
    `;
  }

  async forget(guildId: string, keep: readonly string[]): Promise<void> {
    await this.sql`
      delete from commands_usage
      where guild_id = ${guildId} and not (command_id = any(${this.sql.array([...keep])}::text[]))
    `;
  }

  async saveTest(guildId: string, requestId: string, result: CommandTestResult): Promise<void> {
    await this.sql`
      insert into commands_tests (guild_id, request_id, result)
      values (${guildId}, ${requestId}, ${this.sql.json(result as never)})
      on conflict (guild_id, request_id) do update set result = excluded.result, created_at = now()
    `;
    await this.sql`
      delete from commands_tests
      where created_at < now() - make_interval(mins => ${TEST_TTL_MINUTES})
    `;
  }

  async test(guildId: string, requestId: string): Promise<CommandTestResult | null> {
    const [row] = await this.sql<{ result: CommandTestResult }[]>`
      select result from commands_tests
      where guild_id = ${guildId} and request_id = ${requestId}
    `;
    return row?.result ?? null;
  }
}
