import { MASS_BAN_MAX, splitMassBan } from '@maxwell/core/modules/moderation';
import type { Command, GuildCommand, GuildContext } from '../../../commands/types.js';
import { lines, subtext } from '../../../ui/format.js';
import { modRoleAllow } from '../access.js';
import type { Confirmations } from '../confirm.js';
import { copy } from '../copy.js';
import { caseRange, type MassBanResult, massBan } from '../massban.js';
import type { ModerationService } from '../service.js';
import { expandReason } from '../templates.js';
import { noise, usage } from './shared.js';

const fallback = { ok: '✅' };
const PROGRESS_EVERY = 3_000;

export function massBanReport(result: MassBanResult): string {
  return lines(
    copy.massban.done(result.banned.length, result.total),
    caseRange(result),
    result.skipped.length > 0 && subtext(copy.massban.skipped(result.skipped.length)),
    result.failed.length > 0 && subtext(copy.massban.failed(result.failed.length)),
  );
}

export function massBanCommand(
  moderation: ModerationService,
  confirmations: Confirmations,
): Command {
  const command: GuildCommand = {
    name: 'massban',
    description: copy.commands.massban,
    guildOnly: true,
    args: [{ name: 'members', type: 'text' }],
    examples: ['massban 142700000000000001 142700000000000002 raid', 'massban @a @b @c spam'],
    permissions: ['BanMembers'],
    allow: modRoleAllow,
    botPermissions: ['BanMembers'],
    async run(ctx: GuildContext) {
      const { ids, reason } = splitMassBan(ctx.args.string('members') ?? '');
      if (ids.length === 0) {
        await usage(ctx, command, copy.massban.none);
        return;
      }
      if (ids.length > MASS_BAN_MAX) {
        await noise(ctx, copy.massban.tooMany(MASS_BAN_MAX));
        return;
      }
      const config = await moderation.config(ctx.guildId);
      const expanded = expandReason(config, 'ban', reason, null);
      if (config.requireReason && !expanded.reason) {
        await usage(ctx, command, copy.errors.reasonRequired);
        return;
      }
      await runMassBan(ctx, moderation, confirmations, ids, expanded);
    },
  };
  return command;
}

async function runMassBan(
  ctx: GuildContext,
  moderation: ModerationService,
  confirmations: Confirmations,
  ids: string[],
  expanded: ReturnType<typeof expandReason>,
): Promise<void> {
  const { voice } = ctx.services;
  const { platform } = ctx;
  const channelId = ctx.message.channelId;
  const emoji = voice.icons.reaction('ok') ?? fallback.ok;
  const prompt = await ctx.reply(
    lines(
      copy.massban.confirm(ids.length),
      expanded.reason && subtext(copy.massban.reason(expanded.reason)),
      copy.massban.confirmHint(voice.icon('ok') || emoji),
    ),
  );
  await platform.react(channelId, prompt, emoji).catch(() => {});
  const ok = await confirmations.wait(prompt, ctx.message.author.id, emoji);
  await platform.unreact(channelId, prompt, emoji).catch(() => {});
  if (!ok) {
    await platform.edit(channelId, prompt, copy.massban.expired).catch(() => {});
    return;
  }

  await platform.edit(channelId, prompt, copy.massban.progress(0, ids.length)).catch(() => {});
  let lastEdit = Date.now();
  const result = await massBan(
    moderation,
    {
      guildId: ctx.guildId,
      userIds: ids,
      moderatorId: ctx.message.author.id,
      reason: expanded.reason,
      deleteMessageSeconds: expanded.deleteMessageSeconds,
      source: 'command',
      batch: ctx.message.id,
    },
    async (done, total) => {
      if (done >= total || Date.now() - lastEdit < PROGRESS_EVERY) return;
      lastEdit = Date.now();
      await platform.edit(channelId, prompt, copy.massban.progress(done, total)).catch(() => {});
    },
  );
  const icon = result.banned.length > 0 ? voice.icon('shield') : voice.icon('lock');
  await platform.edit(channelId, prompt, `${icon}${massBanReport(result)}`).catch(() => {});
}
