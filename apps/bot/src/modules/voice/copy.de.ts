import { mention } from '../../commands/mentions.js';
import { lines, subtext } from '../../ui/format.js';
import type { VoiceCopy } from './copy.js';

const de: VoiceCopy = {
  fallbackName: 'Sprachraum',
  notInRoom: 'Du bist in keinem Sprachraum.',
  notOwner: (ownerId: string) => `Nur ${mention.user(ownerId)} kann diesen Raum ändern.`,
  renamed: (name: string) => `Der Raum heißt jetzt **${name}**.`,
  limit: (value: number) => (value === 0 ? 'Kein Limit mehr.' : `Limit ist jetzt ${value}.`),
  locked: 'Raum abgeschlossen. Niemand Neues kommt rein.',
  unlocked: 'Raum wieder offen.',
  alreadyLocked: 'Der Raum ist schon abgeschlossen.',
  alreadyUnlocked: 'Der Raum ist nicht abgeschlossen.',
  transferred: (userId: string) => `Der Raum gehört jetzt ${mention.user(userId)}.`,
  transferSelf: 'Der Raum gehört schon dir.',
  transferAbsent: (userId: string) => `${mention.user(userId)} muss erst im Raum sein.`,
  transferBot: 'Bots können keinen Raum besitzen.',
  info: (channelId: string, ownerId: string, members: number, locked: boolean) =>
    lines(
      `${mention.channel(channelId)} gehört ${mention.user(ownerId)}.`,
      subtext(
        `${members === 1 ? '1 Person' : `${members} Personen`} drin${locked ? ', abgeschlossen' : ''}`,
      ),
    ),
  where: (channelId: string) => `in ${mention.channel(channelId)}`,
  reasons: {
    created: 'Join to create',
    empty: 'Voice room was empty',
    command: 'Room owner',
  },
  commands: {
    room: 'Zeigt, wem der Sprachraum gehört, in dem du bist.',
    name: 'Benennt deinen Sprachraum um.',
    limit: 'Legt fest, wie viele in deinen Sprachraum passen. 0 heißt kein Limit.',
    lock: 'Hält neue Leute aus deinem Sprachraum raus.',
    unlock: 'Öffnet deinen Sprachraum wieder.',
    transfer: 'Gibt deinen Sprachraum an jemanden ab, der drin ist.',
  },
};

export default de;
