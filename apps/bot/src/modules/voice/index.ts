import definition from '@maxwell/core/modules/voice';
import { VoiceStore } from '@maxwell/core/stores/voice';
import { defineBotModule } from '../../runtime/module.js';
import { roomCommand } from './commands.js';
import { Rooms } from './rooms.js';

export default defineBotModule({
  definition,
  setup(ctx) {
    const store = new VoiceStore(ctx.services.sql);
    const rooms = new Rooms(ctx, store);
    const { platform } = ctx.services;

    ctx.on('voiceUpdate', (change) => rooms.onVoice(change), { always: true });
    ctx.on('channelDelete', ({ guildId, channel }) => rooms.onChannelDelete(guildId, channel.id), {
      always: true,
    });
    ctx.on('ready', () => rooms.sweep(), { always: true });
    ctx.on('guildAvailable', (guild) => (platform.isReady() ? rooms.sweep(guild.id) : undefined), {
      always: true,
    });

    ctx.job('room.cleanup', (job) => rooms.cleanup(job));
    ctx.job('sweep', async (job) => {
      if (job.guildId) await rooms.sweep(job.guildId);
    });

    ctx.privacy({
      async export(guildId, userId) {
        const mine = (await rooms.rooms(guildId)).filter(
          (room) => room.ownerId === userId || room.members.includes(userId),
        );
        if (mine.length === 0) return null;
        return {
          rooms: mine.map((room) => ({
            channelId: room.channelId,
            owner: room.ownerId === userId,
            inside: room.members.includes(userId),
            createdAt: room.createdAt.toISOString(),
          })),
        };
      },
      forget: (guildId, userId) => rooms.forgetMember(guildId, userId),
    });

    return [roomCommand(rooms)];
  },
});
