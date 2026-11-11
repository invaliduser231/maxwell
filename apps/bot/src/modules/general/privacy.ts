import type { Command, GuildContext } from '../../commands/types.js';
import { lines, subtext } from '../../ui/format.js';
import { confirmEmojis } from '../economy/confirm.js';
import type { Confirmations } from '../moderation/confirm.js';
import { copy } from './copy.js';

const CONFIRM_TIMEOUT = 60_000;

const mydata: Command = {
  name: 'mydata',
  description: copy.commands.mydata,
  guildOnly: true,
  cooldown: 10 * 60_000,
  async run(ctx) {
    const { privacy, voice, log } = ctx.services;
    const userId = ctx.message.author.id;
    const { data, failed } = await privacy.export(ctx.guildId, userId);
    if (failed.length) log.warn({ guild: ctx.guildId, failed }, 'privacy export incomplete');
    const body = JSON.stringify(
      { community: ctx.guildId, member: userId, exportedAt: new Date().toISOString(), data },
      null,
      2,
    );
    const sent = await ctx.platform.sendDirect(userId, {
      content: Object.keys(data).length ? copy.privacy.exported : copy.privacy.nothingStored,
      files: [{ name: `maxwell-${ctx.guildId}.json`, data: new TextEncoder().encode(body) }],
    });
    if (!sent) {
      await ctx.reply({ content: copy.privacy.noDm, deleteAfter: 30_000 });
      return;
    }
    await ctx.reply(voice.done(copy.privacy.sent, ctx.seed));
  },
};

async function forget(ctx: GuildContext): Promise<string> {
  const { privacy, voice, audit, log } = ctx.services;
  const userId = ctx.message.author.id;
  const failed = await privacy.forget(ctx.guildId, userId);
  await audit.record({
    guildId: ctx.guildId,
    actor: { id: userId },
    module: 'general',
    action: 'privacy.forget',
    summary: 'A member deleted their data',
    undo: null,
  });
  if (failed.length) {
    log.error({ guild: ctx.guildId, failed }, 'privacy forget incomplete');
    return copy.privacy.partial(failed.map((entry) => entry.module).join(', '));
  }
  return voice.done(copy.privacy.forgotten, ctx.seed);
}

function forgetme(confirmations: Confirmations): Command {
  return {
    name: 'forgetme',
    description: copy.commands.forgetme,
    guildOnly: true,
    cooldown: 60_000,
    args: [{ name: 'confirm', type: 'word', optional: true }],
    async run(ctx) {
      if (ctx.args.string('confirm')?.toLowerCase() === 'confirm') {
        await ctx.reply(await forget(ctx));
        return;
      }
      const { platform, voice } = ctx.services;
      const emojis = confirmEmojis(voice.icons);
      const channelId = ctx.message.channelId;
      const prompt = await ctx.reply(
        lines(copy.privacy.warning, subtext(copy.privacy.confirm(emojis.yesLabel, ctx.prefix))),
      );
      await platform.react(channelId, prompt, emojis.yes).catch(() => {});
      const ok = await confirmations.wait(
        prompt,
        ctx.message.author.id,
        emojis.yes,
        CONFIRM_TIMEOUT,
      );
      await platform.unreact(channelId, prompt, emojis.yes).catch(() => {});
      if (!ok) return;
      await platform.edit(channelId, prompt, await forget(ctx)).catch(() => {});
    },
  };
}

export function privacyCommands(confirmations: Confirmations): Command[] {
  return [mydata, forgetme(confirmations)];
}
