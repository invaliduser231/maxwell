import type { SuggestionStatus } from '@maxwell/core/modules/suggestions';
import { mention } from '../../commands/mentions.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/suggestions.json' with { type: 'json' };
import { escapeMarkdown, truncate } from '../../ui/format.js';

export const fallbackVotes = { up: '👍', down: '👎' };

const auditStatusNames: Record<SuggestionStatus, string> = {
  open: 'Open',
  planned: 'Planned',
  done: 'Done',
  declined: 'Declined',
};

export const audit = {
  status: (number: number, status: SuggestionStatus) =>
    `Marked suggestion ${number} as ${auditStatusNames[status]}`,
};

export const copy = catalog('suggestions', en, (m) => ({
  title: (id: string) => m.title({ id }),
  status: (name: string) => m.status({ name }),
  reason: (reason: string) => m.reason({ reason }),
  votes: (up: number, down: number) => m.votes({ up, down }),
  author: (name: string, username: string) => m.author({ name, username }),
  threadName: (id: string, content: string) =>
    truncate(m.threadName({ id, content: content.replace(/\s+/g, ' ').trim() }), 100),
  posted: (channelId: string) => m.posted({ channel: mention.channel(channelId) }),
  inChannel: (channelId: string) => m.inChannel({ channel: mention.channel(channelId) }),
  statusDirect: (number: number, server: string, name: string, content: string) =>
    m.statusDirect({
      number: String(number),
      server: escapeMarkdown(server),
      name: escapeMarkdown(name),
      content: truncate(content.replace(/\s+/g, ' '), 200),
    }),
  statusDirectReason: (reason: string) => m.statusDirectReason({ reason }),
}));
