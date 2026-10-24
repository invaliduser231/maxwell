export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { catalogMigrations, migrate, silentLogger } = await import('@maxwell/core');
  const { db } = await import('./lib/db');
  await migrate(db().sql, silentLogger, catalogMigrations());
}
