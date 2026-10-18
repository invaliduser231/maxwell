import type { Command } from '../../commands/types.js';
import { lines, subtext } from '../../ui/format.js';
import { copy } from './copy.js';

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

const forgetme: Command = {
  name: 'forgetme',
  description: copy.commands.forgetme,
  guildOnly: true,
  cooldown: 60_000,
  args: [{ name: 'confirm', type: 'word', optional: true }],
  async run(ctx) {
    const { privacy, voice, audit, log } = ctx.services;
    if (ctx.args.string('confirm')?.toLowerCase() !== 'confirm') {
      await ctx.reply(lines(copy.privacy.warning, subtext(copy.privacy.confirm(ctx.prefix))));
      return;
    }
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
      await ctx.reply(copy.privacy.partial(failed.map((entry) => entry.module).join(', ')));
      return;
    }
    await ctx.reply(voice.done(copy.privacy.forgotten, ctx.seed));
  },
};

export const privacyCommands: Command[] = [mydata, forgetme];
