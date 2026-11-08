import type { CounterType } from '@maxwell/core/modules/counters';
import { mention } from '../../commands/mentions.js';
import { localized } from '../../i18n/localized.js';
import { code } from '../../ui/format.js';
import de from './copy.de.js';
import es from './copy.es.js';

const en = {
  commands: {
    counter: 'Channel names that keep count.',
    add: 'Creates a counter channel.',
    list: 'Lists the counter channels.',
  },
  types: {
    members: 'Members',
    online: 'Online',
    goal: 'Member goal',
    voice: 'In voice',
    channels: 'Channels',
    roles: 'Roles',
    countdown: 'Countdown',
  } satisfies Record<CounterType, string>,
  templates: {
    members: 'Members: {count}',
    online: 'Online: {count}',
    goal: 'Goal: {count} / {goal}',
    voice: 'In voice: {count}',
    channels: 'Channels: {count}',
    roles: 'Roles: {count}',
    countdown: '{count} days to go',
  } satisfies Record<CounterType, string>,
  unknownType: (types: string) => `Pick one of these: ${types}.`,
  needsGoal: (prefix: string) =>
    `A goal needs a number, like ${code(`${prefix}counter add goal 1000`)}.`,
  needsDate: (prefix: string) =>
    `A countdown needs a date, like ${code(`${prefix}counter add countdown 2027-01-01`)}.`,
  full: (limit: number) => `This community already has ${limit} counters.`,
  created: (channelId: string) =>
    `Counting in ${mention.channel(channelId)}. The name updates every few minutes.`,
  failed: 'I could not create the channel. Check that I can manage channels.',
  listTitle: 'Counters',
  listLine: (channelId: string, type: string) => `${mention.channel(channelId)}  ${type}`,
  empty: (prefix: string) => [
    `No counters yet. ${code(`${prefix}counter add members`)} sets one up.`,
    `Nothing is counting yet. Try ${code(`${prefix}counter add members`)}.`,
  ],
};

export type CountersCopy = typeof en;

export const copy = localized(en, { de, es });

export const audit = {
  added: (type: string) => `Added a ${type} counter`,
  channelGone: 'Removed a counter whose channel was deleted',
};

export const reasons = {
  update: 'Counter update',
  create: 'Counter channel',
};
