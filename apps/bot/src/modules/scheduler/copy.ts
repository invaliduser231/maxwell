import { mention } from '../../commands/mentions.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/scheduler.json' with { type: 'json' };
import type { Permission } from '../../platform/types.js';
import { code, escapeMarkdown, lines, subtext, timestamp } from '../../ui/format.js';
import { andList, permissionNames } from '../../ui/voice.js';

export const stateErrors = {
  channel: 'The channel is gone or I cannot see it.',
  permissions: (missing: readonly Permission[]) =>
    `Missing ${andList(missing.map((permission) => permissionNames[permission]))}.`,
  late: 'Skipped. I was offline when it was due.',
  failed: 'Fluxer rejected the message.',
};

export const copy = catalog('scheduler', en, (m) => ({
  tooFar: (days: number) => m.tooFar({ days }),
  tooMany: (max: number, prefix: string) =>
    lines(m.tooMany({ max }), subtext(m.tooManyHint({ prefix }))),
  set: (due: Date) => m.set({ when: timestamp(due, 'R') }),
  setHint: (prefix: string, number: number) =>
    subtext(
      m.setHint({ number: String(number), command: code(`${prefix}reminders cancel ${number}`) }),
    ),
  deliver: (userId: string, content: string, createdAt: Date) =>
    lines(
      m.deliver({ user: mention.user(userId), content }),
      subtext(m.deliverNote({ when: timestamp(createdAt, 'R') })),
    ),
  deliverDm: (guildName: string | null, content: string, createdAt: Date) =>
    lines(
      content,
      subtext(
        m.deliverDm({
          place: guildName ? 'guild' : 'none',
          guild: escapeMarkdown(guildName ?? ''),
          when: timestamp(createdAt, 'R'),
        }),
      ),
    ),
  listLine: (number: number, due: Date, content: string) =>
    m.listLine({ number: code(`#${number}`), due: timestamp(due, 'R'), content }),
  listFooter: (prefix: string) => subtext(m.listFooter({ prefix })),
  emptyHint: (prefix: string) => subtext(m.emptyHint({ prefix })),
  cancelled: (number: number) => m.cancelled({ number: String(number) }),
  notFound: (number: number) => ({
    content: m.notFound({ number: code(String(number)) }),
    deleteAfter: 15_000,
  }),
}));
