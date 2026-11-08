import { access } from './es/access';
import { audit } from './es/audit';
import { automod } from './es/automod';
import { backups } from './es/backups';
import { cards } from './es/cards';
import { collection } from './es/collection';
import { commands } from './es/commands';
import { common } from './es/common';
import { counters } from './es/counters';
import { economy } from './es/economy';
import { errors } from './es/errors';
import { events } from './es/events';
import { feeds } from './es/feeds';
import { forms } from './es/forms';
import { games } from './es/games';
import { general } from './es/general';
import { giveaways } from './es/giveaways';
import { inbox } from './es/inbox';
import { insights } from './es/insights';
import { invites } from './es/invites';
import { landing } from './es/landing';
import { levels } from './es/levels';
import { logs } from './es/logs';
import { members } from './es/members';
import { moderation } from './es/moderation';
import { overview } from './es/overview';
import { pages } from './es/pages';
import { publicPage } from './es/public';
import { roles } from './es/roles';
import { scheduler } from './es/scheduler';
import { security } from './es/security';
import { shield } from './es/shield';
import { starboard } from './es/starboard';
import { start } from './es/start';
import { suggestions } from './es/suggestions';
import { support } from './es/support';
import { templates } from './es/templates';
import { tickets } from './es/tickets';
import { time } from './es/time';
import { voice } from './es/voice';
import { welcome } from './es/welcome';

export const messagesEs = {
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
  ...counters,
  ...voice,
  ...logs,
  ...shield,
} as const;
