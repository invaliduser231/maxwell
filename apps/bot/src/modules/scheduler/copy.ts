import { mention } from '../../commands/mentions.js';
import { localized } from '../../i18n/localized.js';
import type { Permission } from '../../platform/types.js';
import { code, escapeMarkdown, lines, plural, subtext, timestamp } from '../../ui/format.js';
import { andList, permissionNames } from '../../ui/voice.js';
import de from './copy.de.js';

export const stateErrors = {
  channel: 'The channel is gone or I cannot see it.',
  permissions: (missing: readonly Permission[]) =>
    `Missing ${andList(missing.map((permission) => permissionNames[permission]))}.`,
  late: 'Skipped. I was offline when it was due.',
  failed: 'Fluxer rejected the message.',
};

const en = {
  commands: {
    remind: 'Reminds you of something later.',
    cancel: 'Drops one of your reminders.',
    reminders: 'Lists your reminders in this community.',
  },
  remindersOff: 'Member reminders are off here.',
  tooFar: (days: number) => `A reminder can be at most ${plural(days, 'day')} away.`,
  tooMany: (max: number, prefix: string) =>
    lines(
      `You already have ${plural(max, 'reminder')} here. That's the limit.`,
      subtext(`${prefix}reminders lists them, ${prefix}reminders cancel <number> drops one.`),
    ),
  set: (due: Date) => `I'll remind you ${timestamp(due, 'R')}.`,
  setHint: (prefix: string, number: number) =>
    subtext(`Reminder ${number}. ${code(`${prefix}reminders cancel ${number}`)} drops it.`),
  deliver: (userId: string, content: string, createdAt: Date) =>
    lines(`${mention.user(userId)} ${content}`, subtext(`You asked ${timestamp(createdAt, 'R')}.`)),
  deliverDm: (guildName: string | null, content: string, createdAt: Date) =>
    lines(
      content,
      subtext(
        guildName
          ? `You asked in ${escapeMarkdown(guildName)} ${timestamp(createdAt, 'R')}.`
          : `You asked ${timestamp(createdAt, 'R')}.`,
      ),
    ),
  listTitle: 'Your reminders',
  listLine: (number: number, due: Date, content: string) =>
    `${code(`#${number}`)}  ${timestamp(due, 'R')}  ${content}`,
  listFooter: (prefix: string) => subtext(`${prefix}reminders cancel <number> drops one.`),
  empty: [
    'No reminders. Your future self is on their own.',
    'Nothing scheduled for you here.',
    'No reminders waiting.',
  ],
  emptyHint: (prefix: string) => subtext(`${prefix}remind 2h stretch your legs`),
  cancelled: (number: number) => `Reminder ${number} is gone.`,
  notFound: (number: number) => ({
    content: `You have no reminder ${code(String(number))} here.`,
    deleteAfter: 15_000,
  }),
};

export type SchedulerCopy = typeof en;

export const copy = localized(en, { de });
