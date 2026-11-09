import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/logs.json' with { type: 'json' };

export const copy = catalog('logs', en, (m) => ({
  inChannel: (channel: string, sent: string | null) =>
    m.inChannel({ channel, sent: sent ?? '', hasSent: sent ? 'yes' : 'no' }),
  youngAccount: (age: string) => m.youngAccount({ age }),
  age: (ms: number) =>
    m.age(
      ms < 3_600_000
        ? { unit: 'minute', n: Math.max(Math.floor(ms / 60_000), 1) }
        : ms < 48 * 3_600_000
          ? { unit: 'hour', n: Math.floor(ms / 3_600_000) }
          : { unit: 'day', n: Math.floor(ms / 86_400_000) },
    ),
  bulkSummary: (n: number, channel: string) => m.bulkSummary({ n, channel }),
  bulkCached: (known: number, total: number) =>
    m.bulkCached({ known, state: known === 0 ? 'none' : known === total ? 'all' : 'some' }),
  voiceJoined: (user: string, channel: string) => m.voiceJoined({ user, channel }),
  voiceLeft: (user: string, channel: string) => m.voiceLeft({ user, channel }),
  voiceMoved: (user: string, from: string, to: string) => m.voiceMoved({ user, from, to }),
  inviteLine: (code: string, channel: string | null) =>
    m.inviteLine({ code, channel: channel ?? '', hasChannel: channel ? 'yes' : 'no' }),
  memberCount: (n: number) => m.memberCount({ n }),
  userFooter: (id: string) => m.userFooter({ id }),
  messageFooter: (userId: string | null, messageId: string) =>
    m.messageFooter({ userId: userId ?? '', messageId, hasUser: userId ? 'yes' : 'no' }),
  roleFooter: (id: string) => m.roleFooter({ id }),
  channelFooter: (id: string) => m.channelFooter({ id }),
  timeoutUntil: (when: string, relative: string) => m.timeoutUntil({ when, relative }),
  change: (label: string, before: string, after: string) => m.change({ label, before, after }),
  more: (n: number) => m.more({ n }),
}));
