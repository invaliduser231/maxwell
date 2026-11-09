import { mention } from '../../commands/mentions.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/starboard.json' with { type: 'json' };

export const copy = catalog('starboard', en, (m) => ({
  starLine: (emoji: string, stars: number, channelId: string) =>
    m.starLine({ emoji, stars, channel: mention.channel(channelId) }),
  attachment: (name: string) => m.attachment({ name }),
  footer: (messageId: string) => m.footer({ messageId }),
}));

export const reasons = {
  removed: 'Starboard post below the threshold',
};
