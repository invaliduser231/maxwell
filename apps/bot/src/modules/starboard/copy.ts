import { mention } from '../../commands/mentions.js';
import { localized } from '../../i18n/localized.js';
import { count } from '../../ui/format.js';
import de from './copy.de.js';

const en = {
  starLine: (emoji: string, stars: number, channelId: string) =>
    `${emoji} **${count(stars)}** in ${mention.channel(channelId)}`,
  jump: 'Jump to message',
  attachment: (name: string) => `Attachment: ${name}`,
  footer: (messageId: string) => `ID ${messageId}`,
};

export type StarboardCopy = typeof en;

export const copy = localized(en, { de });

export const reasons = {
  removed: 'Starboard post below the threshold',
};
