import type { GuildCommand } from '../../../commands/types.js';
import type { ModInbox } from '../inbox.js';
import { inboxCopy } from '../inbox-copy.js';
import { NOISE_TTL } from './shared.js';

const CONFIRM_TTL = 8_000;

export function reportCommands(inbox: ModInbox): GuildCommand[] {
  const report: GuildCommand = {
    name: 'report',
    description: inboxCopy.command,
    guildOnly: true,
    cooldown: 30_000,
    args: [
      { name: 'member', type: 'user', optional: true },
      { name: 'reason', type: 'text', optional: true },
    ],
    examples: ['report spam links', 'report @member keeps sending DMs'],
    async run(ctx) {
      const { platform } = ctx.services;
      const config = await inbox.moderation.config(ctx.guildId);
      const say = (content: string) => ctx.reply({ content, deleteAfter: CONFIRM_TTL });
      if (!config.reports) {
        await say(inboxCopy.off);
        return;
      }

      const named = ctx.args.string('member') ?? null;
      const reason = ctx.args.string('reason')?.trim() || null;
      const replied = ctx.message.replyTo
        ? await platform.message(ctx.message.channelId, ctx.message.replyTo).catch(() => null)
        : null;
      const message = replied && (!named || replied.author.id === named) ? replied : null;
      const subjectId = named ?? message?.author.id ?? null;
      if (!subjectId) {
        await ctx.reply({ content: inboxCopy.nothing, deleteAfter: NOISE_TTL });
        return;
      }
      if (subjectId === ctx.message.author.id) {
        await say(inboxCopy.self);
        return;
      }
      const subject = message?.author ?? (await platform.user(subjectId));
      if (subject?.bot) {
        await say(inboxCopy.bot);
        return;
      }

      const result = await inbox.report(
        ctx.guildId,
        ctx.message.author.id,
        subjectId,
        message,
        reason,
      );
      const removed = await platform
        .delete(ctx.message.channelId, ctx.message.id)
        .then(() => true)
        .catch(() => false);
      const content = result.kind === 'already' ? inboxCopy.already : inboxCopy.sent;
      if (removed) {
        await platform.send(ctx.message.channelId, { content, deleteAfter: CONFIRM_TTL });
      } else {
        await say(content);
      }
    },
  };

  return [report];
}
