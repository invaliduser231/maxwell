import type { SuggestionStatus } from '@maxwell/core/modules/suggestions';
import { mention } from '../../commands/mentions.js';
import { localized } from '../../i18n/localized.js';
import { bold, count, truncate } from '../../ui/format.js';
import de from './copy.de.js';
import es from './copy.es.js';

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

const en = {
  statusNames: {
    open: 'Open',
    planned: 'Planned',
    done: 'Done',
    declined: 'Declined',
  } as Record<SuggestionStatus, string>,
  suggestDescription: 'Posts a suggestion for everyone to vote on.',
  title: (id: string) => `Suggestion ${id}`,
  status: (name: string) => `**Status** ${name}`,
  reason: (reason: string) => `**Reason** ${reason}`,
  votes: (up: number, down: number) => `**Votes** ${count(up)} for, ${count(down)} against`,
  author: (name: string, username: string) => `${name} (@${username})`,
  threadName: (id: string, content: string) =>
    truncate(`${id}: ${content.replace(/\s+/g, ' ').trim()}`, 100),

  posted: (channelId: string) => `Posted in ${mention.channel(channelId)}.`,
  inChannel: (channelId: string) => `in ${mention.channel(channelId)}`,
  noChannel: "Suggestions don't have a channel yet. An admin can pick one in the dashboard.",
  channelGone: 'The suggestions channel is gone. An admin can pick a new one in the dashboard.',
  tooLong: 'Keep it under 2,000 characters.',
  empty: 'I need the suggestion itself.',

  statusDirect: (number: number, server: string, name: string, content: string) =>
    `Your suggestion ${number} in ${bold(server)} is now ${bold(name)}.\n> ${truncate(content.replace(/\s+/g, ' '), 200)}`,
  statusDirectReason: (reason: string) => `**Reason** ${reason}`,
};

export type SuggestionsCopy = typeof en;

export const copy = localized(en, { de, es });
