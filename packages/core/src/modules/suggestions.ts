import { z } from 'zod';
import { defineModule } from './types.js';

export const suggestionStatuses = ['open', 'planned', 'done', 'declined'] as const;

export type SuggestionStatus = (typeof suggestionStatuses)[number];

export const suggestionsConfig = z.object({
  channelId: z.string().nullable().default(null),
  upEmoji: z.string().min(1).max(100).nullable().default(null),
  downEmoji: z.string().min(1).max(100).nullable().default(null),
  cleanup: z.boolean().default(true),
  notifyAuthor: z.boolean().default(true),
  thread: z.boolean().default(true),
});

export type SuggestionsConfig = z.infer<typeof suggestionsConfig>;

export default defineModule({
  key: 'suggestions',
  name: 'Suggestions',
  description: 'Suggestions with votes and status.',
  group: 'community',
  pole: 'north',
  voteLocked: false,
  defaultEnabled: false,
  toggleable: true,
  config: suggestionsConfig,
  migrations: [
    {
      id: '1-suggestions',
      up: `
        create table suggestions_items (
          id bigint generated always as identity primary key,
          guild_id bigint not null,
          channel_id bigint not null,
          message_id bigint unique,
          author_id bigint not null,
          content text not null,
          up_emoji text not null,
          down_emoji text not null,
          status text not null default 'open'
            check (status in ('open', 'planned', 'done', 'declined')),
          reason text,
          status_by bigint,
          status_at timestamptz,
          up integer not null default 0,
          down integer not null default 0,
          created_at timestamptz not null default now()
        );

        create index suggestions_items_guild on suggestions_items (guild_id, status, created_at desc);
        create index suggestions_items_top on suggestions_items (guild_id, (up - down) desc);

        create table suggestions_votes (
          suggestion_id bigint not null references suggestions_items (id) on delete cascade,
          user_id bigint not null,
          vote smallint not null check (vote in (-1, 1)),
          voted_at timestamptz not null default now(),
          primary key (suggestion_id, user_id)
        );
      `,
    },
    {
      id: '2-anonymous',
      up: `
        alter table suggestions_items alter column author_id drop not null;
        create index suggestions_items_author on suggestions_items (guild_id, author_id);
        create index suggestions_votes_user on suggestions_votes (user_id);
      `,
    },
    {
      id: '3-numbers',
      up: `
        alter table suggestions_items add column number integer;
        update suggestions_items s set number = ranked.n
        from (
          select id, row_number() over (partition by guild_id order by id) as n from suggestions_items
        ) ranked
        where ranked.id = s.id;
        alter table suggestions_items alter column number set not null;
        create unique index suggestions_items_number on suggestions_items (guild_id, number);
      `,
    },
  ],
});
