import { mention } from '../../commands/mentions.js';
import { count } from '../../ui/format.js';
import type { StarboardCopy } from './copy.js';

const es: StarboardCopy = {
  starLine: (emoji: string, stars: number, channelId: string) =>
    `${emoji} **${count(stars)}** en ${mention.channel(channelId)}`,
  jump: 'Ir al mensaje',
  attachment: (name: string) => `Adjunto: ${name}`,
  footer: (messageId: string) => `ID ${messageId}`,
};

export default es;
