import {
  AuditStore,
  connect,
  FluxerList,
  GuildStore,
  generalConfig,
  holdInstanceLock,
  type InstanceLock,
  ModuleStore,
  migrate,
  Votes,
  writeMeta,
} from '@maxwell/core';
import { CardStyles } from './cards/styles.js';
import { Dispatcher } from './commands/dispatcher.js';
import { commandCatalog, Registry } from './commands/registry.js';
import { loadConfig } from './config.js';
import { startHealthServer } from './health.js';
import { setLanguageSource } from './i18n/language.js';
import { createLogger } from './log.js';
import { FluxerPlatform } from './platform/fluxer.js';
import { loadModules, moduleMigrations } from './runtime/bootstrap.js';
import { PrivacyRegistry } from './runtime/privacy.js';
import { Scheduler } from './runtime/scheduler.js';
import { Settings } from './runtime/settings.js';
import { watchStructure } from './runtime/structure.js';
import { UndoRegistry } from './runtime/undo.js';
import type { Services } from './services.js';
import { parseIconSet } from './ui/icons.js';
import { Mascot } from './ui/mascot.js';
import { Paginator } from './ui/paginator.js';
import { Voice } from './ui/voice.js';

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL, config.NODE_ENV === 'development');
const sql = connect(config.DATABASE_URL);

await migrate(sql, log, moduleMigrations());

const platform = new FluxerPlatform({ token: config.FLUXER_TOKEN, api: config.FLUXER_API, log });
const audit = new AuditStore(sql);
const modules = new ModuleStore(sql, audit);
const settings = new Settings(sql, modules, log);
setLanguageSource(
  async (guildId) => (await settings.config(guildId, 'general', generalConfig)).language,
);
const jobs = new Scheduler(sql, log);
const undo = new UndoRegistry(audit, modules);
const icons = parseIconSet(config.ICON_EMOJIS);
const fluxerList =
  config.FLUXERLIST_API_KEY && config.FLUXERLIST_BOT_ID
    ? new FluxerList({
        apiBase: config.FLUXERLIST_API_BASE,
        apiKey: config.FLUXERLIST_API_KEY,
        botId: config.FLUXERLIST_BOT_ID,
      })
    : null;

const services: Services = {
  config,
  log,
  sql,
  platform,
  guilds: new GuildStore(sql, config.DEFAULT_PREFIX),
  modules,
  settings,
  audit,
  jobs,
  undo,
  privacy: new PrivacyRegistry(),
  votes: new Votes(sql, fluxerList, log),
  cards: new CardStyles(sql, modules),
  registry: new Registry(),
  voice: new Voice(icons),
  mascot: new Mascot(),
  pages: new Paginator(platform, icons),
  startedAt: new Date(),
};

undo.attach(jobs);
settings.onInvalidate((payload) => {
  const [guildId, key] = payload.split(':');
  if (guildId && key === 'prefix') services.guilds.forgetPrefix(guildId);
});
await settings.listen();
const loaded = await loadModules(services);
await writeMeta(sql, 'commands', commandCatalog(services.registry)).catch((error) =>
  log.warn({ err: error }, 'could not publish command list'),
);

const stopStructure = watchStructure(platform, sql, log);
const dispatcher = new Dispatcher(services);
platform.on('message', (message) => {
  dispatcher.handle(message).catch((error) => log.error({ err: error }, 'dispatch failed'));
});

const health = startHealthServer(config.HEALTH_PORT, {
  live: () => true,
  ready: async () => {
    if (!platform.isReady()) return false;
    await sql`select 1`;
    return true;
  },
});

let stopping = false;
let lock: InstanceLock | null = null;
const waiting = new AbortController();
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, 'shutting down');
  waiting.abort();
  jobs.stop();
  stopStructure();
  await loaded.shutdown();
  health.close();
  await platform.disconnect().catch((error) => log.warn({ err: error }, 'disconnect failed'));
  await lock?.release();
  await sql.end({ timeout: 5 });
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  lock = await holdInstanceLock(sql, 'maxwell.bot', {
    signal: waiting.signal,
    onWait: (attempt) => {
      if (attempt % 12 === 0) log.warn('another bot instance is running, waiting for it to stop');
    },
  });
} catch (error) {
  if (!stopping) throw error;
}
if (!stopping) {
  await platform.connect();
  jobs.start();
}
