import type { AuditStore, GuildStore, ModuleStore, Sql, Votes } from '@maxwell/core';
import type { CardStyles } from './cards/styles.js';
import type { Registry } from './commands/registry.js';
import type { Config } from './config.js';
import type { Logger } from './log.js';
import type { Platform } from './platform/types.js';
import type { PrivacyRegistry } from './runtime/privacy.js';
import type { Scheduler } from './runtime/scheduler.js';
import type { Settings } from './runtime/settings.js';
import type { UndoRegistry } from './runtime/undo.js';
import type { Mascot } from './ui/mascot.js';
import type { Paginator } from './ui/paginator.js';
import type { Voice } from './ui/voice.js';

export interface Services {
  config: Config;
  log: Logger;
  sql: Sql;
  platform: Platform;
  guilds: GuildStore;
  modules: ModuleStore;
  settings: Settings;
  audit: AuditStore;
  jobs: Scheduler;
  undo: UndoRegistry;
  privacy: PrivacyRegistry;
  votes: Votes;
  cards: CardStyles;
  registry: Registry;
  voice: Voice;
  mascot: Mascot;
  pages: Paginator;
  startedAt: Date;
}
