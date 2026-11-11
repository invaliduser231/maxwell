import { ModerationStore } from '@maxwell/core/stores/moderation';
import type { SecurityStore } from '@maxwell/core/stores/security';
import { ShieldStore } from '@maxwell/core/stores/shield';
import type { Command } from '../../commands/types.js';
import { lines, timestamp } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { checkCommand } from './check.js';
import { copy } from './copy.js';
import type { Ctx } from './guard.js';
import type { Honeypot } from './honeypot.js';
import type { RaidWatch } from './raid.js';
import { isStaff, staffVerify } from './staff-verify.js';
import type { Verifier } from './verification.js';

export function securityCommands(
  ctx: Ctx,
  store: SecurityStore,
  verifier: Verifier,
  raid: RaidWatch,
  honeypot: Honeypot,
): Command[] {
  const verify: Command = {
    name: 'verify',
    description: copy.commands.verify,
    args: [{ name: 'code', type: 'text', optional: true }],
    examples: ['verify 12345', 'verify new', 'verify @member'],
    async run(cmd) {
      const input = cmd.args.string('code');
      const text = input ?? 'new';
      const author = cmd.message.author.id;
      const reply = (content: string) =>
        cmd.reply({ content, deleteAfter: cmd.guildId ? 15_000 : undefined });
      const staff = cmd.guildId
        ? await staffVerify(ctx, verifier, {
            guildId: cmd.guildId,
            channelId: cmd.message.channelId,
            authorId: author,
            text: input ?? null,
          })
        : null;
      if (staff) {
        await cmd.reply({ content: staff, mentionUsers: [] });
      } else {
        const handled = await verifier.answer(author, text, cmd.guildId, reply);
        if (!handled) {
          const team = cmd.guildId ? await isStaff(ctx, cmd.guildId, author) : false;
          await reply(team ? copy.staffVerify.notHere : copy.dm.nothing);
        }
      }
      if (cmd.guildId) {
        await cmd.platform.delete(cmd.message.channelId, cmd.message.id).catch(() => {});
      }
    },
  };

  const status: Command = {
    name: 'status',
    description: copy.commands.status,
    guildOnly: true,
    permissions: ['ModerateMembers'],
    async run(cmd) {
      const config = await ctx.config(cmd.guildId);
      const [active, counts] = await Promise.all([
        store.activeRaid(cmd.guildId),
        store.counts(cmd.guildId, new Date(Date.now() - 86_400_000)),
      ]);
      await cmd.reply({
        embeds: [
          {
            color: active ? palette.warning : palette.south,
            title: copy.status.title,
            description: lines(
              copy.status.verification(config.verification.enabled, config.verification.threshold),
              copy.status.raid(
                config.raid.enabled,
                active?.endsAt ? timestamp(active.endsAt, 'R') : null,
              ),
              copy.status.nuke(config.nuke.enabled),
              copy.status.honeypot(config.honeypot.enabled, config.honeypot.channelIds.length),
              counts.pending > 0 ? copy.status.pending(counts.pending) : null,
            ),
          },
        ],
      });
    },
  };

  const raidOn: Command = {
    name: 'raid',
    description: copy.commands.raid,
    guildOnly: true,
    permissions: ['ManageGuild'],
    examples: ['security raid'],
    async run(cmd) {
      if (await store.activeRaid(cmd.guildId)) {
        await cmd.reply({ content: copy.raid.already, deleteAfter: 15_000 });
        return;
      }
      await raid.start(
        cmd.guildId,
        { kind: 'manual', userId: cmd.message.author.id },
        { id: cmd.message.author.id },
      );
      await cmd.reply(
        cmd.services.voice.done(copy.raid.started.manual(cmd.message.author.id), cmd.seed),
      );
    },
  };

  const calm: Command = {
    name: 'calm',
    description: copy.commands.calm,
    guildOnly: true,
    permissions: ['ManageGuild'],
    examples: ['security calm'],
    async run(cmd) {
      const ended = await raid.end(cmd.guildId, { id: cmd.message.author.id });
      if (!ended) {
        await cmd.reply({ content: copy.raid.notActive, deleteAfter: 15_000 });
        return;
      }
      await cmd.reply(cmd.services.voice.done(copy.raid.calmed(cmd.message.author.id), cmd.seed));
    },
  };

  const pass: Command = {
    name: 'pass',
    description: copy.commands.pass,
    guildOnly: true,
    permissions: ['ModerateMembers'],
    botPermissions: ['ManageRoles'],
    args: [{ name: 'member', type: 'user' }],
    examples: ['security pass @Lena'],
    async run(cmd) {
      const userId = cmd.args.string('member');
      if (!userId) return;
      const pending = await store.pending(cmd.guildId, userId);
      if (!pending) {
        await cmd.reply({ content: copy.replies.notPending(userId), deleteAfter: 15_000 });
        return;
      }
      await verifier.pass(cmd.guildId, userId, cmd.message.author.id);
      await cmd.reply(cmd.services.voice.done(copy.replies.passed(userId), cmd.seed));
    },
  };

  const trap: Command = {
    name: 'honeypot',
    description: copy.commands.honeypot,
    guildOnly: true,
    permissions: ['ManageGuild'],
    botPermissions: ['ManageChannels'],
    cooldown: 30_000,
    examples: ['security honeypot'],
    async run(cmd) {
      const channelId = await honeypot.setup(cmd.guildId, { id: cmd.message.author.id });
      if (!channelId) {
        await cmd.reply(cmd.services.voice.botMissingPermissions(['ManageChannels'], 'here'));
        return;
      }
      await cmd.reply(cmd.services.voice.done(copy.replies.honeypotMade(channelId), cmd.seed));
    },
  };

  const share: Command = {
    name: 'shield',
    description: copy.commands.shield,
    guildOnly: true,
    permissions: ['BanMembers'],
    args: [{ name: 'member', type: 'user' }],
    examples: ['security shield @raider'],
    async run(cmd) {
      const userId = cmd.args.string('member');
      if (!userId) return;
      const config = await ctx.config(cmd.guildId);
      if (!config.shield.enabled) {
        await cmd.reply({ content: copy.replies.shieldOff, deleteAfter: 15_000 });
        return;
      }
      const ban = await new ModerationStore(cmd.services.sql).openCase(cmd.guildId, userId, 'ban');
      if (!ban) {
        await cmd.reply({ content: copy.replies.notBanned(userId), deleteAfter: 15_000 });
        return;
      }
      await new ShieldStore(cmd.services.sql).report(
        cmd.guildId,
        userId,
        'manual',
        cmd.message.author.id,
      );
      await cmd.reply(cmd.services.voice.done(copy.replies.shared(userId), cmd.seed));
    },
  };

  const unshare: Command = {
    name: 'unshield',
    description: copy.commands.unshield,
    guildOnly: true,
    permissions: ['BanMembers'],
    args: [{ name: 'member', type: 'user' }],
    examples: ['security unshield @member'],
    async run(cmd) {
      const userId = cmd.args.string('member');
      if (!userId) return;
      const removed = await new ShieldStore(cmd.services.sql).withdraw(cmd.guildId, userId);
      await cmd.reply(
        removed
          ? cmd.services.voice.done(copy.replies.unshared(userId), cmd.seed)
          : { content: copy.replies.notShared(userId), deleteAfter: 15_000 },
      );
    },
  };

  return [
    verify,
    {
      name: 'security',
      aliases: ['sec'],
      description: copy.commands.security,
      guildOnly: true,
      permissions: status.permissions,
      run: status.run,
      subcommands: [status, checkCommand(ctx), raidOn, calm, pass, trap, share, unshare],
    },
  ];
}
