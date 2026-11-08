import { mention } from '../../commands/mentions.js';
import { localized } from '../../i18n/localized.js';
import { lines, subtext } from '../../ui/format.js';
import de from './copy.de.js';
import es from './copy.es.js';

const en = {
  fallbackName: 'Voice room',
  notInRoom: "You're not in a voice room.",
  notOwner: (ownerId: string) => `Only ${mention.user(ownerId)} can change this room.`,
  renamed: (name: string) => `The room is called **${name}** now.`,
  limit: (value: number) => (value === 0 ? 'No user limit now.' : `Limit is ${value} now.`),
  locked: 'Room locked. Nobody new gets in.',
  unlocked: 'Room open again.',
  alreadyLocked: 'The room is already locked.',
  alreadyUnlocked: "The room isn't locked.",
  transferred: (userId: string) => `${mention.user(userId)} owns this room now.`,
  transferSelf: 'You already own this room.',
  transferAbsent: (userId: string) => `${mention.user(userId)} has to be in the room first.`,
  transferBot: 'Bots cannot own a room.',
  info: (channelId: string, ownerId: string, members: number, locked: boolean) =>
    lines(
      `${mention.channel(channelId)} belongs to ${mention.user(ownerId)}.`,
      subtext(
        `${members === 1 ? '1 person' : `${members} people`} inside${locked ? ', locked' : ''}`,
      ),
    ),
  where: (channelId: string) => `in ${mention.channel(channelId)}`,
  reasons: {
    created: 'Join to create',
    empty: 'Voice room was empty',
    command: 'Room owner',
  },
  commands: {
    room: 'Shows who owns the voice room you are in.',
    name: 'Renames your voice room.',
    limit: 'Sets how many people fit in your voice room. 0 means no limit.',
    lock: 'Keeps new people out of your voice room.',
    unlock: 'Opens your voice room again.',
    transfer: 'Hands your voice room to someone inside it.',
  },
};

export type VoiceCopy = typeof en;

export const copy = localized(en, { de, es });
