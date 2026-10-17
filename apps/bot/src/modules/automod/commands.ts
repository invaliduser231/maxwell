import type { AutomodStore } from '@maxwell/core/stores/automod';
import { mention } from '../../commands/mentions.js';
import type { Command, GuildContext } from '../../commands/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { lines, timestamp } from '../../ui/format.js';
import { chunk } from '../../ui/paginator.js';
import { palette } from '../../ui/palette.js';
import type { Confirmations } from './confirm.js';
import { copy } from './copy.js';
import type { RaidShield } from './shield.js';
import type { automodConfig } from './types.js';

const PAGE_SIZE = 15;

export function gateCommand(
  ctx: ModuleContext<typeof automodConfig>,
  store: AutomodStore,
  shield: RaidShield,
  confirmations: Confirmations,
): Command {
  const list: Command = {
    name: 'list',
    description: copy.commands.list,
    guildOnly: true,
    permissions: ['ModerateMembers'],
    args: [{ name: 'page', type: 'integer', min: 1, max: 100, optional: true }],
    examples: ['gate list', 'gate list 2'],
    async run(cmd) {
      const { voice } = cmd.services;
      const [held, incident] = await Promise.all([
        store.held(cmd.guildId),
        shield.active(cmd.guildId),
      ]);
      if (held.length === 0) {
        await cmd.reply(voice.empty('automod.gate', copy.gateEmpty, cmd.seed));
        return;
      }
      const until = incident?.endsAt ? timestamp(incident.endsAt, 't') : null;
      const head = copy.gateIncident(held.length, incident ? until : null);
      const pages = chunk(held, PAGE_SIZE).map((group) => ({
        color: palette.warning,
        title: copy.gateTitle,
        description: lines(
          head,
          '',
          ...group.map((entry) =>
            copy.gateLine(
              mention.user(entry.userId),
              timestamp(entry.heldAt, 'R'),
              copy.holds[entry.reason],
            ),
          ),
        ),
      }));
      await cmd.services.pages.send(cmd, pages, (cmd.args.number('page') ?? 1) - 1);
    },
  };

  const letin: Command = {
    name: 'letin',
    description: copy.commands.let,
    guildOnly: true,
    permissions: ['ManageRoles'],
    botPermissions: ['ManageRoles'],
    args: [{ name: 'member', type: 'user', optional: true }],
    examples: ['gate letin', 'gate letin @Lena'],
    async run(cmd) {
      const { voice } = cmd.services;
      const config = await ctx.config(cmd.guildId);
      if (!config.raid.gateRoleId) {
        await cmd.reply(copy.noGateRole);
        return;
      }
      const userId = cmd.args.string('member');
      const by = { id: cmd.message.author.id };
      if (userId) {
        if (!(await store.isHeld(cmd.guildId, userId))) {
          await cmd.reply({ content: copy.notHeld(mention.user(userId)), deleteAfter: 15_000 });
          return;
        }
        const result = await shield.letIn(cmd.guildId, [userId], by);
        await cmd.reply(
          result.done.length > 0
            ? voice.done(copy.letInOne(mention.user(userId)), cmd.seed)
            : voice.botMissingPermissions(['ManageRoles'], 'here'),
        );
        return;
      }
      const held = await store.held(cmd.guildId);
      if (held.length === 0) {
        await cmd.reply(voice.empty('automod.gate', copy.gateEmpty, cmd.seed));
        return;
      }
      const result = await shield.letIn(cmd.guildId, null, by);
      await cmd.reply(
        result.failed.length === 0
          ? voice.done(copy.letInAll(result.done.length), cmd.seed)
          : copy.letInPartial(result.done.length, result.done.length + result.failed.length),
      );
    },
  };

  const banall: Command = {
    name: 'banall',
    description: copy.commands.ban,
    guildOnly: true,
    permissions: ['BanMembers'],
    botPermissions: ['BanMembers'],
    cooldown: 10_000,
    examples: ['gate banall'],
    async run(cmd) {
      await banAll(cmd);
    },
  };

  async function banAll(cmd: GuildContext): Promise<void> {
    const { voice, platform } = cmd.services;
    const held = await store.held(cmd.guildId);
    if (held.length === 0) {
      await cmd.reply(voice.empty('automod.gate', copy.gateEmpty, cmd.seed));
      return;
    }
    const ok = voice.icon('ok').trim() || confirmations.emoji;
    const prompt = await cmd.reply(copy.banConfirm(held.length, ok));
    const confirmed = await confirmations.wait(
      cmd.message.channelId,
      prompt,
      cmd.message.author.id,
    );
    if (!confirmed) {
      await platform.edit(cmd.message.channelId, prompt, copy.banTimeout).catch(() => undefined);
      await platform
        .unreact(cmd.message.channelId, prompt, confirmations.emoji)
        .catch(() => undefined);
      return;
    }
    const ids = held.map((entry) => entry.userId);
    const result = await shield.banAll(cmd.guildId, ids, { id: cmd.message.author.id });
    const text =
      result.failed.length === 0
        ? voice.done(copy.bannedAll(result.done.length), cmd.seed)
        : copy.bannedPartial(result.done.length, ids.length);
    await platform.edit(cmd.message.channelId, prompt, text).catch(() => cmd.reply(text));
    await platform
      .unreact(cmd.message.channelId, prompt, confirmations.emoji)
      .catch(() => undefined);
  }

  return {
    name: 'gate',
    description: copy.commands.gate,
    guildOnly: true,
    subcommands: [list, letin, banall],
  };
}
