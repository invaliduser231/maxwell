import { localized } from '../i18n/localized.js';
import de from './copy.de.js';
import es from './copy.es.js';
import { code } from './format.js';

const en = {
  done: ['Sorted.', 'Done.', 'Saved.'],
  missingPermissions: (list: string) => `You need ${list} for that.`,
  botMissingPermissions: (list: string, where: string) => `I need ${list} ${where} for that.`,
  here: 'here',
  there: 'there',
  inCommunity: 'in this community',
  moduleOff: (name: string) => `${name} is off here. An admin can turn it on in the dashboard.`,
  guildOnly: 'That only works inside a community.',
  cooldown: ['Easy.', 'One at a time.'],
  tryAgain: (when: string) => `Try again ${when}.`,
  failed: (errorCode: string) =>
    `That didn't work on my side. It's logged as ${code(errorCode)}. Try again in a minute.`,
  pickOne: 'Pick one.',
  args: {
    missing: (name: string) => `I need a ${name} for that.`,
    user: (name: string) => `That's not a ${name} I can find.`,
    channel: "That's not a channel I can see.",
    role: "That's not a role here.",
    durationMissing: (name: string) =>
      `I need a ${name} for that, like ${code('10m')} or ${code('2h')}.`,
    duration: `That's not a duration I know. Try ${code('10m')}, ${code('2h')} or ${code('3d')}.`,
    between: (name: string, min: number, max: number) =>
      `The ${name} has to be between ${min} and ${max}.`,
    whole: (name: string) => `The ${name} has to be a whole number.`,
  },
  unknownCommand: (typed: string, suggestion: string) =>
    `No command called ${code(typed)}. Did you mean ${code(suggestion)}?`,
  prefixHint: (prefix: string) =>
    `Prefix here is ${code(prefix)}. ${code(`${prefix}help`)} lists everything.`,
  prefixAgain: (prefix: string) => `Still here. Still ${code(prefix)}.`,
  prefixThird: 'I heard you the first two times.',
  page: (index: number, total: number) => `Page ${index} of ${total}`,
  eggs: {
    demon: 'Only the thermodynamic kind.',
    sort: 'Fast ones left, slow ones right. Sorted.',
    who: 'Maxwell. I keep things in order around here.',
  },
};

export type UiCopy = typeof en;

export const uiCopy = localized(en, { de, es });
