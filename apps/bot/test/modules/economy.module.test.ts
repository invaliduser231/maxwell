import {
  type AuditEntry,
  type AuditInput,
  connect,
  type Job,
  migrate,
  type Sql,
} from '@maxwell/core';
import definition from '@maxwell/core/modules/economy';
import { EconomyStore } from '@maxwell/core/stores/economy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { Command, GuildContext } from '../../src/commands/types.js';
import { createLogger } from '../../src/log.js';
import economy from '../../src/modules/economy/index.js';
import { createContext } from '../../src/runtime/module.js';
import { PrivacyRegistry } from '../../src/runtime/privacy.js';
import type { JobHandler } from '../../src/runtime/scheduler.js';
import type { UndoHandler } from '../../src/runtime/undo.js';
import type { Services } from '../../src/services.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('economy module', () => {
  let sql: Sql;
  let store: EconomyStore;
  const guild = String(915_000_000_000_000n + BigInt(Math.floor(Math.random() * 1_000_000_000)));
  const a = '410000000000000001';
  const b = '410000000000000002';
  const c = '410000000000000003';
  const jobs = new Map<string, JobHandler>();
  const undos = new Map<string, UndoHandler>();
  const records: AuditInput[] = [];
  const privacy = new PrivacyRegistry();
  let commands: Command[] = [];

  const job = (kind: string, payload: Record<string, unknown>): Job => ({
    id: '1',
    kind,
    guildId: guild,
    payload,
    runAt: new Date(),
    attempts: 1,
  });

  const entry = (input: AuditInput): AuditEntry => ({
    id: String(records.indexOf(input) + 1),
    guildId: input.guildId,
    actorId: input.actor.id,
    module: input.module,
    action: input.action,
    summary: input.summary,
    before: input.before,
    after: input.after,
    undo: input.undo ?? null,
    createdAt: new Date(),
    undoneAt: null,
    undoneBy: null,
  });

  beforeAll(async () => {
    sql = connect(url as string);
    await migrate(sql, createLogger('silent', false), [
      { module: 'economy', migrations: definition.migrations },
    ]);
    store = new EconomyStore(sql);
    const services = {
      sql,
      privacy,
      log: createLogger('silent', false),
      platform: { on: () => {} },
      jobs: {
        handle: (kind: string, handler: JobHandler) => jobs.set(kind, handler),
        enqueue: async () => null,
      },
      undo: { handle: (kind: string, handler: UndoHandler) => undos.set(kind, handler) },
      settings: {
        config: async (_g: string, _k: string, schema: z.ZodType) => schema.parse({}),
        enabled: async () => true,
      },
      audit: {
        record: async (input: AuditInput) => {
          records.push(input);
          return String(records.length);
        },
      },
    } as unknown as Services;
    commands = ((await economy.setup?.(createContext(economy.definition, services))) ??
      []) as Command[];
  });

  afterAll(async () => {
    for (const table of [
      'economy_wallets',
      'economy_transactions',
      'economy_supply',
      'economy_stock',
      'economy_purchases',
      'economy_inventory',
      'economy_reset_balances',
      'economy_resets',
    ]) {
      await sql`delete from ${sql(table)} where guild_id = ${guild}`;
    }
    await sql.end();
  });

  it('registers privacy and jobs', () => {
    expect(privacy.modules()).toEqual(['economy']);
    expect([...jobs.keys()]).toContain('economy.reset');
    expect([...undos.keys()]).toContain('economy.reset');
  });

  it('lets staff give and take coins with an audit entry that undoes it', async () => {
    const coins = commands.find((command) => command.name === 'coins');
    const [add, remove] = coins?.subcommands ?? [];
    const replies: string[] = [];
    const run = (command: Command | undefined, amount: number) =>
      command?.run?.({
        guildId: guild,
        seed: 1,
        message: { author: { id: a } },
        args: {
          string: (name: string) =>
            name === 'member' ? c : name === 'reason' ? 'voted' : undefined,
          number: () => amount,
        },
        services: { voice: { done: (text: string) => text } },
        reply: async (out: { content: string }) => {
          replies.push(out.content);
          return '1';
        },
      } as unknown as GuildContext);
    expect(add?.permissions).toEqual(['ManageGuild']);
    await run(add, 500);
    expect(await store.balance(guild, c)).toBe(500);
    expect(replies.at(-1)).toContain('500');
    const record = records.at(-1);
    expect(record?.action).toBe('economy.adjust');
    await run(remove, 800);
    expect(await store.balance(guild, c)).toBe(0);
    await run(remove, 10);
    expect(replies.at(-1)).toContain('nothing to take');
    if (!record) throw new Error('no record');
    await undos.get('economy.adjust')?.(entry(record), record.undo?.payload ?? {}, { id: a });
    expect(await store.balance(guild, c)).toBe(0);
  });

  it('resets balances and undoes it on top of what was earned since', async () => {
    await store.credit(guild, a, 300, 'admin');
    await store.credit(guild, b, 120, 'admin');
    await jobs.get('economy.reset')?.(job('economy.reset', { by: c }));

    expect(await store.balance(guild, a)).toBe(0);
    expect(await store.balance(guild, b)).toBe(0);
    const record = records.at(-1);
    expect(record?.action).toBe('economy.reset');
    expect(record?.actor.id).toBe(c);
    expect(record?.undo?.kind).toBe('economy.reset');
    const history = await store.supplyHistory(guild, 2);
    expect(history.at(-1)?.supply).toBe(await store.totalSupply(guild));

    await store.credit(guild, a, 5, 'admin');
    if (!record) throw new Error('no record');
    const undo = undos.get('economy.reset');
    await undo?.(entry(record), record.undo?.payload ?? {}, { id: c });
    expect(await store.balance(guild, a)).toBe(305);
    expect(await store.balance(guild, b)).toBe(120);

    await undo?.(entry(record), record.undo?.payload ?? {}, { id: c });
    expect(await store.balance(guild, a)).toBe(305);
    const ledger = await store.transactions(guild, { userId: b });
    expect(ledger.map((row) => row.kind)).toEqual(['undo', 'reset', 'admin']);
  });

  it('skips the audit entry when every wallet is already empty', async () => {
    const quiet = String(BigInt(guild) + 1n);
    const before = records.length;
    await jobs.get('economy.reset')?.({ ...job('economy.reset', {}), guildId: quiet });
    expect(records.length).toBe(before);
  });

  it('exports and forgets a member', async () => {
    await store.transfer(guild, a, b, 100, 0);
    await store.grantItem(guild, a, 'pack', 'standard', 2);
    await jobs.get('economy.reset')?.(job('economy.reset', {}));

    const { data, failed } = await privacy.export(guild, a);
    expect(failed).toEqual([]);
    const part = data.economy as {
      wallet: { balance: number };
      transactions: { kind: string }[];
      inventory: { ref: string; quantity: number }[];
      resets: { balance: number }[];
    };
    expect(part.wallet.balance).toBe(0);
    expect(part.transactions.map((row) => row.kind)).toContain('transfer');
    expect(part.inventory).toEqual([{ kind: 'pack', ref: 'standard', quantity: 2 }]);
    expect(part.resets.map((row) => row.balance)).toEqual([300, 205]);

    await store.credit(guild, a, 40, 'admin');
    expect(await privacy.forget(guild, a)).toEqual([]);
    expect((await privacy.export(guild, a)).data).toEqual({});
    const theirs = await store.transactions(guild, { userId: b, kind: 'transfer' });
    expect(theirs[0]?.counterpartId).toBeNull();
    const [left] = await sql<{ n: number }[]>`
      select count(*)::int as n from economy_reset_balances where guild_id = ${guild} and user_id = ${a}
    `;
    expect(left?.n).toBe(0);
    const history = await store.supplyHistory(guild, 2);
    expect(history.at(-1)?.supply).toBe(await store.totalSupply(guild));
  });
});
