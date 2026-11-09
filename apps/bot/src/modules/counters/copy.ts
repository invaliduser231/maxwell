import { mention } from '../../commands/mentions.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/counters.json' with { type: 'json' };

export const copy = catalog('counters', en, (m) => ({
  unknownType: (types: string) => m.unknownType({ types }),
  needsGoal: (prefix: string) => m.needsGoal({ prefix }),
  needsDate: (prefix: string) => m.needsDate({ prefix }),
  full: (limit: number) => m.full({ limit: String(limit) }),
  created: (channelId: string) => m.created({ channel: mention.channel(channelId) }),
  listLine: (channelId: string, type: string) =>
    m.listLine({ channel: mention.channel(channelId), type }),
  empty: (prefix: string) => m.empty({ prefix }),
}));

export const audit = {
  added: (type: string) => `Added a ${type} counter`,
  channelGone: 'Removed a counter whose channel was deleted',
};

export const reasons = {
  update: 'Counter update',
  create: 'Counter channel',
};
