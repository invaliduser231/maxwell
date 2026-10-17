import { installLive } from '../live/live.js';
import type { Logger } from '../log.js';
import type { ModuleMigration } from '../modules/types.js';
import { coreMigrations, type Migration } from './migrations.js';
import type { Sql } from './sql.js';

const LOCK_ID = 7_351_902_114;

export interface ModuleMigrations {
  module: string;
  migrations: ModuleMigration[];
}

export async function migrate(
  sql: Sql,
  log: Logger,
  modules: ModuleMigrations[] = [],
  core: Migration[] = coreMigrations,
): Promise<number> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK_ID})`;
    await tx`
      create table if not exists schema_migrations (
        id integer primary key,
        name text not null,
        applied_at timestamptz not null default now()
      )
    `;
    const rows = await tx<{ id: number }[]>`select id from schema_migrations`;
    const applied = new Set(rows.map((row) => row.id));
    let count = 0;

    for (const migration of [...core].sort((a, b) => a.id - b.id)) {
      if (applied.has(migration.id)) continue;
      await tx.unsafe(migration.up);
      await tx`insert into schema_migrations (id, name) values (${migration.id}, ${migration.name})`;
      log.info({ id: migration.id, name: migration.name }, 'migration applied');
      count++;
    }

    const done = new Set(
      (await tx<{ id: string }[]>`select id from module_migrations`).map((row) => row.id),
    );
    for (const { module, migrations } of modules) {
      for (const migration of migrations) {
        const id = `${module}/${migration.id}`;
        if (done.has(id)) continue;
        await tx.unsafe(migration.up);
        await tx`insert into module_migrations (id) values (${id})`;
        log.info({ id }, 'module migration applied');
        count++;
      }
    }
    await installLive(tx as unknown as Sql);
    return count;
  });
}
