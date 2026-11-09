import { mention } from '../../commands/mentions.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/insights.json' with { type: 'json' };

export const copy = catalog('insights', en, (m) => ({
  channelsTitle: (days: number) => m.channelsTitle({ days: String(days) }),
  channelLine: (rank: number, channelId: string, value: string) =>
    m.channelLine({ rank: String(rank), channel: mention.channel(channelId), value }),
  messages: (value: number) => m.messages({ value }),
  minutes: (value: number) =>
    m.minutes({
      unit: value >= 120 ? 'hours' : 'minutes',
      hours: Math.round(value / 60),
      minutes: value,
    }),
  membersTitle: (days: number) => m.membersTitle({ days: String(days) }),
  memberLine: (rank: number, userId: string, value: string) =>
    m.memberLine({ rank: String(rank), user: mention.user(userId), value }),
  userTitle: (name: string) => m.userTitle({ name }),
  userLines: (messages: number, days: number, range: number) =>
    m.userLines({ messages, days, range }),
  lastSeen: (when: string) => m.lastSeen({ when }),
  quiet: (range: number) => m.quiet({ range: String(range) }),
}));
