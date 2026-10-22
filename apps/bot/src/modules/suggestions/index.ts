import definition, {
  type SuggestionStatus,
  suggestionStatuses,
} from '@maxwell/core/modules/suggestions';
import { SuggestionStore } from '@maxwell/core/stores/suggestions';
import { defineBotModule } from '../../runtime/module.js';
import { SuggestionBoard } from './board.js';
import { suggestionCommands } from './commands.js';
import { audit } from './copy.js';

const MAX_REASON = 1_000;

function idOf(value: unknown): string | null {
  const text = typeof value === 'number' ? String(value) : value;
  return typeof text === 'string' && /^\d{1,19}$/.test(text) ? text : null;
}

function statusOf(value: unknown): SuggestionStatus | null {
  return (suggestionStatuses as readonly unknown[]).includes(value)
    ? (value as SuggestionStatus)
    : null;
}

function reasonOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const reason = value.trim().slice(0, MAX_REASON);
  return reason.length > 0 ? reason : null;
}

function byOf(value: unknown): string | null {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : null;
}

export default defineBotModule({
  definition,
  setup(ctx) {
    const { sql, log } = ctx.services;
    const store = new SuggestionStore(sql);
    const board = new SuggestionBoard(ctx, store);

    ctx.on('reaction', (reaction) => board.onReaction(reaction));
    ctx.on('reactionRemove', (reaction) => board.onReactionRemove(reaction));

    ctx.job('status', async (job) => {
      if (!job.guildId) return;
      const id = idOf(job.payload.suggestionId);
      const status = statusOf(job.payload.status);
      if (!id || !status) {
        log.warn({ guild: job.guildId, job: job.id }, 'invalid suggestion status payload');
        return;
      }
      const by = byOf(job.payload.by);
      const change = await board.setStatus(
        job.guildId,
        id,
        status,
        reasonOf(job.payload.reason),
        by,
        true,
      );
      if (!change) return;
      const summary = audit.status(change.after.number, status);
      await ctx.record(job.guildId, { id: by }, 'suggestion.status', summary, {
        before: change.before,
        after: {
          status: change.after.status,
          reason: change.after.reason,
          number: change.after.number,
        },
        undo: {
          kind: 'status',
          payload: {
            suggestionId: id,
            status: change.before.status,
            reason: change.before.reason,
          },
        },
      });
    });

    ctx.undo('status', async (entry, payload, by) => {
      const id = idOf(payload.suggestionId);
      const status = statusOf(payload.status);
      if (!id || !status) return;
      await board.setStatus(entry.guildId, id, status, reasonOf(payload.reason), by.id, false);
    });

    ctx.privacy({
      async export(guildId, userId) {
        const data = await store.memberData(guildId, userId);
        if (data.authored.length + data.votes.length === 0) return null;
        return {
          suggestions: data.authored.map((suggestion) => ({
            id: suggestion.id,
            content: suggestion.content,
            status: suggestion.status,
            reason: suggestion.reason,
            up: suggestion.up,
            down: suggestion.down,
            createdAt: suggestion.createdAt.toISOString(),
          })),
          votes: data.votes.map((vote) => ({
            suggestionId: vote.suggestionId,
            vote: vote.vote === 1 ? 'for' : 'against',
            votedAt: vote.votedAt.toISOString(),
          })),
        };
      },
      async forget(guildId, userId) {
        const anonymised = await store.forget(guildId, userId);
        await board.anonymise(anonymised);
      },
    });

    return suggestionCommands(ctx, board);
  },
});
