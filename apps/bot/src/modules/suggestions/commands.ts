import type { suggestionsConfig } from '@maxwell/core/modules/suggestions';
import type { Command } from '../../commands/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import type { SuggestionBoard } from './board.js';
import { copy } from './copy.js';

type Context = ModuleContext<typeof suggestionsConfig>;

const MAX_LENGTH = 2_000;
const NOISE = 15_000;

export function suggestionCommands(module: Context, board: SuggestionBoard): Command[] {
  const suggest: Command = {
    name: 'suggest',
    aliases: ['suggestion', 'idea'],
    description: copy.suggestDescription,
    guildOnly: true,
    cooldown: 60_000,
    args: [{ name: 'suggestion', type: 'text' }],
    examples: ['suggest A channel for pet pictures'],
    async run(ctx) {
      const { voice, platform } = ctx.services;
      const content = (ctx.args.string('suggestion') ?? '').trim();
      if (!content) {
        await ctx.reply({ content: copy.empty, deleteAfter: NOISE });
        return;
      }
      if (content.length > MAX_LENGTH) {
        await ctx.reply({ content: copy.tooLong, deleteAfter: NOISE });
        return;
      }

      const result = await board.post(ctx.guildId, ctx.message.author, content);
      if (!result.ok) {
        if (result.reason === 'permissions') {
          const config = await module.config(ctx.guildId);
          await ctx.reply(
            voice.botMissingPermissions(
              result.missing ?? [],
              copy.inChannel(config.channelId ?? ''),
            ),
          );
          return;
        }
        await ctx.reply(result.reason === 'gone' ? copy.channelGone : copy.noChannel);
        return;
      }

      const config = await module.config(ctx.guildId);
      if (result.channelId === ctx.message.channelId && config.cleanup) {
        const deleted = await platform
          .delete(ctx.message.channelId, ctx.message.id)
          .then(() => true)
          .catch(() => false);
        if (deleted) return;
      }
      if (result.channelId !== ctx.message.channelId) {
        await ctx.reply(voice.done(copy.posted(result.channelId), ctx.seed));
      }
    },
  };

  return [suggest];
}
