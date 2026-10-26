import type { Key } from './i18n';

export type Pole = 'north' | 'south' | 'neutral';

export interface PageInfo {
  key: string;
  name: Key;
  module: string | null;
  pole: Pole;
  locked: boolean;
  icon: string;
  adminOnly?: boolean;
}

export interface PageGroup {
  title: Key | '';
  pages: PageInfo[];
}

export const POLE_COLOR: Record<Pole, string> = {
  north: '#F26B3A',
  south: '#3A9EEA',
  neutral: '#5A5E66',
};

const icons: Record<string, string> = {
  overview: 'M44 44h30v30H44zM86 44h30v30H86zM44 86h30v30H44zM86 86h30v30H86z',
  moderation: 'M80 36l38 14v28c0 25-17 42-38 48-21-6-38-23-38-48V50z',
  members: 'M80 40a18 18 0 1 0 0 36 18 18 0 1 0 0-36zM46 122c4-20 18-32 34-32s30 12 34 32',
  automod: 'M90 36 56 88h26l-12 36 36-54H80z',
  security: 'M54 78h52v42H54zM64 78V62a16 16 0 0 1 32 0v16M80 94v10',
  logs: 'M46 54h68M46 80h68M46 106h44',
  backups: 'M48 54c0-8 64-8 64 0v52c0 8-64 8-64 0zM48 54c0 8 64 8 64 0M48 80c0 8 64 8 64 0',
  welcome:
    'M44 46h72a8 8 0 0 1 8 8v40a8 8 0 0 1-8 8H78l-22 18v-18H44a8 8 0 0 1-8-8V54a8 8 0 0 1 8-8z',
  invites:
    'M44 56h72a8 8 0 0 1 8 8v40a8 8 0 0 1-8 8H44a8 8 0 0 1-8-8V64a8 8 0 0 1 8-8zM40 62l40 28 40-28',
  levels: 'M44 116V96M70 116V76M96 116V58M122 116V40',
  roles: 'M44 44h40l36 36-40 40-36-36zM62 62h2',
  tickets: 'M38 56h84v16a10 10 0 0 0 0 20v16H38V92a10 10 0 0 0 0-20z',
  forms: 'M54 40h52v84H54zM66 64h28M66 84h28M66 104h16',
  suggestions: 'M80 38a28 28 0 0 0-16 51v13h32V89a28 28 0 0 0-16-51zM68 118h24',
  giveaways: 'M42 66h76v16H42zM48 82v40h64V82M80 66v56',
  events: 'M42 50h76v68H42zM42 70h76M60 40v18M100 40v18',
  starboard: 'M80 38l12 26 28 3-21 19 6 28-25-14-25 14 6-28-21-19 28-3z',
  economy: 'M80 40a40 40 0 1 0 0 80 40 40 0 1 0 0-80zM80 58v44',
  collection: 'M50 50h44v64H50zM66 40h44v64',
  games: 'M44 44h72v72H44zM64 64h2M96 96h2M80 80h2',
  feeds: 'M48 112h2M48 82a30 30 0 0 1 30 30M48 52a60 60 0 0 1 60 60',
  commands: 'M56 60l20 20-20 20M84 104h28',
  scheduler: 'M80 40a40 40 0 1 0 0 80 40 40 0 1 0 0-80zM80 58v24l16 10',
  insights: 'M40 110l26-28 20 16 34-44',
  voice: 'M44 68h16l22-18v60L60 92H44zM98 66a20 20 0 0 1 0 28',
  cards:
    'M40 50h80a6 6 0 0 1 6 6v48a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6V56a6 6 0 0 1 6-6zM40 100l24-24 18 18 12-12 26 22',
  general: 'M80 58a22 22 0 1 0 0 44 22 22 0 1 0 0-44zM80 34v12M80 114v12M34 80h12M114 80h12',
  access: 'M60 64a20 20 0 1 0 0 40 20 20 0 1 0 0-40zM78 84h46M108 84v16',
  audit: 'M116 80a36 36 0 1 1-11-26M106 34v22H84',
};

const LOCKED = new Set([
  'backups',
  'forms',
  'economy',
  'collection',
  'feeds',
  'commands',
  'insights',
]);

function page(
  key: string,
  name: Key,
  pole: Pole,
  module: string | null = key,
  adminOnly = false,
): PageInfo {
  return { key, name, module, pole, locked: LOCKED.has(key), icon: icons[key] ?? '', adminOnly };
}

export const pageGroups: PageGroup[] = [
  { title: '', pages: [page('overview', 'Overview', 'neutral', null)] },
  {
    title: 'Keeping order',
    pages: [
      page('moderation', 'Moderation', 'south'),
      page('members', 'Member files', 'south', 'moderation'),
      page('automod', 'AutoMod', 'south'),
      page('security', 'Security', 'south'),
      page('logs', 'Logs', 'south'),
      page('backups', 'Backups', 'south'),
    ],
  },
  {
    title: 'Community',
    pages: [
      page('welcome', 'Welcome', 'north'),
      page('invites', 'Invites', 'north'),
      page('levels', 'Levels', 'north'),
      page('roles', 'Roles', 'north'),
      page('tickets', 'Tickets', 'north'),
      page('forms', 'Forms', 'north'),
      page('suggestions', 'Suggestions', 'north'),
      page('giveaways', 'Giveaways', 'north'),
      page('events', 'Events and polls', 'north'),
      page('starboard', 'Starboard', 'north'),
    ],
  },
  {
    title: 'Play',
    pages: [
      page('economy', 'Economy', 'north'),
      page('collection', 'Collection', 'north'),
      page('games', 'Games', 'north'),
    ],
  },
  {
    title: 'Tools',
    pages: [
      page('feeds', 'Feeds', 'south'),
      page('commands', 'Custom commands', 'south'),
      page('scheduler', 'Scheduler', 'south'),
      page('insights', 'Insights', 'south'),
      page('voice', 'Voice rooms', 'south'),
    ],
  },
  {
    title: 'Settings',
    pages: [
      page('cards', 'Cards', 'neutral'),
      page('general', 'General', 'neutral'),
      page('access', 'Dashboard access', 'neutral', null, true),
      page('audit', 'Audit trail', 'neutral', null, true),
    ],
  },
];

export const allPages: PageInfo[] = pageGroups.flatMap((group) => group.pages);

export function pageByKey(key: string): PageInfo | undefined {
  return allPages.find((entry) => entry.key === key);
}

export const lockedCount = LOCKED.size;
