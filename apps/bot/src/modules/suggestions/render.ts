import type { SuggestionStatus } from '@maxwell/core/modules/suggestions';
import type { Suggestion } from '@maxwell/core/stores/suggestions';
import type { Embed, UserRef } from '../../platform/types.js';
import { lines, truncate } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { copy } from './copy.js';

export const statusColors: Record<SuggestionStatus, number> = {
  open: palette.north,
  planned: palette.south,
  done: palette.success,
  declined: palette.muted,
};

export function suggestionEmbed(suggestion: Suggestion, author: UserRef | null): Embed {
  return {
    color: statusColors[suggestion.status],
    author: author
      ? { name: copy.author(author.displayName, author.username), iconUrl: author.avatarUrl }
      : undefined,
    title: copy.title(String(suggestion.number)),
    description: lines(
      truncate(suggestion.content, 3_500),
      '',
      copy.status(copy.statusNames[suggestion.status]),
      suggestion.reason && copy.reason(truncate(suggestion.reason, 400)),
      suggestion.status !== 'open' && copy.votes(suggestion.up, suggestion.down),
    ),
  };
}
