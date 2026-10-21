import { mention } from '../../commands/mentions.js';
import { count } from '../../ui/format.js';
import type { StarboardCopy } from './copy.js';

const de: StarboardCopy = {
  starLine: (emoji: string, stars: number, channelId: string) =>
    `${emoji} **${count(stars)}** in ${mention.channel(channelId)}`,
  jump: 'Zur Nachricht',
  attachment: (name: string) => `Anhang: ${name}`,
  footer: (messageId: string) => `ID ${messageId}`,
};

export default de;
