import type { BotModule } from '../runtime/module.js';
import automod from './automod/index.js';
import backups from './backups/index.js';
import cards from './cards/index.js';
import collection from './collection/index.js';
import customCommands from './commands/index.js';
import counters from './counters/index.js';
import economy from './economy/index.js';
import eventsModule from './events/index.js';
import feeds from './feeds/index.js';
import forms from './forms/index.js';
import games from './games/index.js';
import general from './general/index.js';
import giveaways from './giveaways/index.js';
import insights from './insights/index.js';
import invites from './invites/index.js';
import levels from './levels/index.js';
import logs from './logs/index.js';
import moderation from './moderation/index.js';
import roles from './roles/index.js';
import scheduler from './scheduler/index.js';
import security from './security/index.js';
import starboard from './starboard/index.js';
import suggestions from './suggestions/index.js';
import tickets from './tickets/index.js';
import voice from './voice/index.js';
import welcome from './welcome/index.js';

export const botModules: BotModule[] = [
  general,
  invites,
  moderation,
  automod,
  security,
  logs,
  backups,
  welcome,
  levels,
  roles,
  tickets,
  forms,
  suggestions,
  giveaways,
  eventsModule,
  starboard,
  counters,
  economy,
  collection,
  games,
  feeds,
  customCommands,
  scheduler,
  insights,
  voice,
  cards,
];
