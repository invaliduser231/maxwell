import { mention } from '../../commands/mentions.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/voice.json' with { type: 'json' };
import { lines, subtext } from '../../ui/format.js';

export const copy = catalog('voice', en, (m) => ({
  notOwner: (ownerId: string) => m.notOwner({ owner: mention.user(ownerId) }),
  renamed: (name: string) => m.renamed({ name }),
  limit: (value: number) => m.limit({ value }),
  transferred: (userId: string) => m.transferred({ user: mention.user(userId) }),
  transferAbsent: (userId: string) => m.transferAbsent({ user: mention.user(userId) }),
  info: (channelId: string, ownerId: string, members: number, locked: boolean) =>
    lines(
      m.info({ channel: mention.channel(channelId), owner: mention.user(ownerId) }),
      subtext(m.infoInside({ members, locked: locked ? 'yes' : 'no' })),
    ),
  where: (channelId: string) => m.where({ channel: mention.channel(channelId) }),
}));
