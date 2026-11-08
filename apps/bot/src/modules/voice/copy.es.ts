import { mention } from '../../commands/mentions.js';
import { lines, subtext } from '../../ui/format.js';
import type { VoiceCopy } from './copy.js';

const es: VoiceCopy = {
  fallbackName: 'Sala de voz',
  notInRoom: 'No estás en ninguna sala de voz.',
  notOwner: (ownerId: string) => `Solo ${mention.user(ownerId)} puede cambiar esta sala.`,
  renamed: (name: string) => `La sala ahora se llama **${name}**.`,
  limit: (value: number) => (value === 0 ? 'Ya no hay límite.' : `El límite ahora es ${value}.`),
  locked: 'Sala cerrada. No entra nadie nuevo.',
  unlocked: 'Sala abierta otra vez.',
  alreadyLocked: 'La sala ya está cerrada.',
  alreadyUnlocked: 'La sala no está cerrada.',
  transferred: (userId: string) => `Ahora la sala es de ${mention.user(userId)}.`,
  transferSelf: 'La sala ya es tuya.',
  transferAbsent: (userId: string) => `${mention.user(userId)} tiene que estar en la sala primero.`,
  transferBot: 'Los bots no pueden ser dueños de una sala.',
  info: (channelId: string, ownerId: string, members: number, locked: boolean) =>
    lines(
      `${mention.channel(channelId)} es de ${mention.user(ownerId)}.`,
      subtext(
        `${members === 1 ? '1 persona' : `${members} personas`} dentro${locked ? ', cerrada' : ''}`,
      ),
    ),
  where: (channelId: string) => `en ${mention.channel(channelId)}`,
  reasons: {
    created: 'Join to create',
    empty: 'Voice room was empty',
    command: 'Room owner',
  },
  commands: {
    room: 'Muestra de quién es la sala de voz en la que estás.',
    name: 'Cambia el nombre de tu sala de voz.',
    limit: 'Define cuántas personas caben en tu sala de voz. 0 significa sin límite.',
    lock: 'No deja entrar a gente nueva en tu sala de voz.',
    unlock: 'Vuelve a abrir tu sala de voz.',
    transfer: 'Pasa tu sala de voz a alguien que esté dentro.',
  },
};

export default es;
