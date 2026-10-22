import type { VoiceRoom } from '@maxwell/core/stores/voice';
import type { Command, GuildCommand, GuildContext } from '../../commands/types.js';
import { escapeMarkdown } from '../../ui/format.js';
import { copy } from './copy.js';
import { cleanName } from './naming.js';
import type { Rooms } from './rooms.js';

async function ownedRoom(ctx: GuildContext, rooms: Rooms): Promise<VoiceRoom | null> {
  const { platform, services } = ctx;
  const userId = ctx.message.author.id;
  const room = await rooms.roomOf(ctx.guildId, userId);
  if (!room) {
    await ctx.reply({ content: copy.notInRoom, deleteAfter: 15_000 });
    return null;
  }
  if (
    room.ownerId !== userId &&
    !(await platform.hasPermissions(ctx.guildId, userId, room.channelId, ['ManageChannels']))
  ) {
    await ctx.reply({ content: copy.notOwner(room.ownerId), deleteAfter: 15_000 });
    return null;
  }
  const missing = await platform.missingBotPermissions(ctx.guildId, room.channelId, [
    'ManageChannels',
  ]);
  if (missing.length) {
    await ctx.reply(services.voice.botMissingPermissions(missing, copy.where(room.channelId)));
    return null;
  }
  return room;
}

export function roomCommand(rooms: Rooms): Command {
  const name: GuildCommand = {
    name: 'name',
    description: copy.commands.name,
    guildOnly: true,
    cooldown: 30_000,
    args: [{ name: 'name', type: 'text' }],
    examples: ['room name Late night chat'],
    async run(ctx) {
      const value = cleanName(ctx.args.string('name') ?? '');
      if (!value) return;
      const room = await ownedRoom(ctx, rooms);
      if (!room) return;
      await rooms.rename(room, value);
      await ctx.reply(ctx.services.voice.done(copy.renamed(escapeMarkdown(value)), ctx.seed));
    },
  };

  const limit: GuildCommand = {
    name: 'limit',
    description: copy.commands.limit,
    guildOnly: true,
    cooldown: 5_000,
    args: [{ name: 'limit', type: 'integer', min: 0, max: 99 }],
    examples: ['room limit 4', 'room limit 0'],
    async run(ctx) {
      const value = ctx.args.number('limit') ?? 0;
      const room = await ownedRoom(ctx, rooms);
      if (!room) return;
      await rooms.setLimit(room, value);
      await ctx.reply(ctx.services.voice.done(copy.limit(value), ctx.seed));
    },
  };

  const lockCommand = (locked: boolean): GuildCommand => ({
    name: locked ? 'lock' : 'unlock',
    description: locked ? copy.commands.lock : copy.commands.unlock,
    guildOnly: true,
    cooldown: 5_000,
    examples: [locked ? 'room lock' : 'room unlock'],
    async run(ctx) {
      const room = await ownedRoom(ctx, rooms);
      if (!room) return;
      if (room.locked === locked) {
        await ctx.reply({
          content: locked ? copy.alreadyLocked : copy.alreadyUnlocked,
          deleteAfter: 15_000,
        });
        return;
      }
      await rooms.setLocked(room, locked);
      await ctx.reply(ctx.services.voice.done(locked ? copy.locked : copy.unlocked, ctx.seed));
    },
  });

  const transfer: GuildCommand = {
    name: 'transfer',
    description: copy.commands.transfer,
    guildOnly: true,
    cooldown: 5_000,
    args: [{ name: 'member', type: 'user' }],
    examples: ['room transfer @Lena'],
    async run(ctx) {
      const target = ctx.args.string('member');
      if (!target) return;
      const room = await ownedRoom(ctx, rooms);
      if (!room) return;
      if (target === room.ownerId) {
        await ctx.reply({ content: copy.transferSelf, deleteAfter: 15_000 });
        return;
      }
      if (!room.members.includes(target)) {
        await ctx.reply({ content: copy.transferAbsent(target), deleteAfter: 15_000 });
        return;
      }
      const member = await ctx.platform.member(ctx.guildId, target);
      if (!member || member.user.bot) {
        await ctx.reply({ content: copy.transferBot, deleteAfter: 15_000 });
        return;
      }
      await rooms.transfer(room, target);
      await ctx.reply(ctx.services.voice.done(copy.transferred(target), ctx.seed));
    },
  };

  return {
    name: 'room',
    description: copy.commands.room,
    guildOnly: true,
    subcommands: [name, limit, lockCommand(true), lockCommand(false), transfer],
    examples: ['room', 'room lock', 'room transfer @Lena'],
    async run(ctx) {
      const room = await rooms.roomOf(ctx.guildId, ctx.message.author.id);
      if (!room) {
        await ctx.reply({ content: copy.notInRoom, deleteAfter: 15_000 });
        return;
      }
      await ctx.reply(copy.info(room.channelId, room.ownerId, room.members.length, room.locked));
    },
  };
}
