import automod from './automod.js';
import backups from './backups.js';
import cards from './cards.js';
import collection from './collection.js';
import commands from './commands.js';
import economy from './economy.js';
import events from './events.js';
import feeds from './feeds.js';
import forms from './forms.js';
import games from './games.js';
import general from './general.js';
import giveaways from './giveaways.js';
import insights from './insights.js';
import invites from './invites.js';
import levels from './levels.js';
import logs from './logs.js';
import moderation from './moderation.js';
import roles from './roles.js';
import scheduler from './scheduler.js';
import starboard from './starboard.js';
import suggestions from './suggestions.js';
import tickets from './tickets.js';
import type { ModuleDefinition } from './types.js';
import voice from './voice.js';
import welcome from './welcome.js';

export const catalog: readonly ModuleDefinition[] = [
  moderation,
  automod,
  logs,
  backups,
  welcome,
  invites,
  levels,
  roles,
  tickets,
  forms,
  suggestions,
  giveaways,
  events,
  starboard,
  economy,
  collection,
  games,
  feeds,
  commands,
  scheduler,
  insights,
  voice,
  cards,
  general,
];

const byKey = new Map(catalog.map((definition) => [definition.key, definition]));

export function moduleByKey(key: string): ModuleDefinition | undefined {
  return byKey.get(key);
}

export const voteLockedKeys = catalog.filter((m) => m.voteLocked).map((m) => m.key);

export function catalogMigrations(): {
  module: string;
  migrations: ModuleDefinition['migrations'];
}[] {
  return catalog.map((definition) => ({
    module: definition.key,
    migrations: definition.migrations,
  }));
}
