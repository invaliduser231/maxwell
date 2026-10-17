import { connect, migrate } from '@maxwell/core';
import { createLogger } from '../log.js';
import { moduleMigrations } from '../runtime/bootstrap.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const log = createLogger('info', process.stdout.isTTY);
const sql = connect(url);

try {
  const count = await migrate(sql, log, moduleMigrations());
  log.info({ count }, count ? 'database migrated' : 'database up to date');
} finally {
  await sql.end();
}
