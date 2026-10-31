import { access } from './de/access';
import { audit } from './de/audit';
import { automod } from './de/automod';
import { backups } from './de/backups';
import { cards } from './de/cards';
import { collection } from './de/collection';
import { commands } from './de/commands';
import { common } from './de/common';
import { economy } from './de/economy';
import { errors } from './de/errors';
import { events } from './de/events';
import { feeds } from './de/feeds';
import { forms } from './de/forms';
import { games } from './de/games';
import { general } from './de/general';
import { giveaways } from './de/giveaways';
import { inbox } from './de/inbox';
import { insights } from './de/insights';
import { invites } from './de/invites';
import { landing } from './de/landing';
import { levels } from './de/levels';
import { logs } from './de/logs';
import { members } from './de/members';
import { moderation } from './de/moderation';
import { overview } from './de/overview';
import { pages } from './de/pages';
import { publicPage } from './de/public';
import { roles } from './de/roles';
import { scheduler } from './de/scheduler';
import { security } from './de/security';
import { starboard } from './de/starboard';
import { start } from './de/start';
import { suggestions } from './de/suggestions';
import { support } from './de/support';
import { templates } from './de/templates';
import { tickets } from './de/tickets';
import { time } from './de/time';
import { voice } from './de/voice';
import { welcome } from './de/welcome';

export const messages = {
  ...time,
  ...pages,
  ...security,
  ...common,
  ...errors,
  ...start,
  ...landing,
  ...overview,
  ...audit,
  ...access,
  ...automod,
  ...backups,
  ...templates,
  ...cards,
  ...collection,
  ...commands,
  ...economy,
  ...events,
  ...feeds,
  ...forms,
  ...games,
  ...general,
  ...publicPage,
  ...giveaways,
  ...insights,
  ...invites,
  ...members,
  ...moderation,
  ...inbox,
  ...tickets,
  ...support,
  ...scheduler,
  ...roles,
  ...levels,
  ...suggestions,
  ...welcome,
  ...starboard,
  ...voice,
  ...logs,
} as const;
