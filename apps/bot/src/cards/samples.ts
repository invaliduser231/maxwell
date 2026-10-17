import { loadImage } from '@napi-rs/canvas';
import type { GuildRef, UserRef } from '../platform/types.js';
import type { Services } from '../services.js';
import { loadAvatar } from './avatar.js';
import { renderLeaderboard } from './leaderboard.js';
import { renderLevelUp } from './levelup.js';
import { renderRank } from './rank.js';
import type { CardStyle } from './theme.js';
import { renderWelcome } from './welcome.js';

export const sampleKinds = ['welcome', 'goodbye', 'rank', 'levelup', 'leaderboard'] as const;

export type SampleKind = (typeof sampleKinds)[number];

export async function renderSample(
  services: Services,
  kind: SampleKind,
  user: UserRef,
  guild: GuildRef | null,
  style: CardStyle,
): Promise<Buffer> {
  const face = await loadAvatar(user.avatarUrl, user.displayName, style.theme);
  const members = guild?.memberCount ?? 100;
  const community = guild?.name ?? 'this community';

  switch (kind) {
    case 'welcome':
      return renderWelcome({
        kind,
        title: `Welcome, ${user.displayName}`,
        subtitle: `Member #${members.toLocaleString('en-US')} of ${community}`,
        avatar: face,
        style,
      });
    case 'goodbye':
      return renderWelcome({
        kind,
        title: `Goodbye, ${user.displayName}`,
        subtitle: `${community} is down to ${(members - 1).toLocaleString('en-US')}`,
        avatar: face,
        style,
      });
    case 'rank':
      return renderRank({
        name: user.displayName,
        username: user.username,
        avatar: face,
        level: 12,
        rank: 4,
        xp: 840,
        needed: 1_200,
        style,
      });
    case 'levelup': {
      const art = services.mascot.get('happy');
      return renderLevelUp({
        name: user.displayName,
        avatar: face,
        level: 25,
        reward: { name: 'Regular', color: '#3A9EEA' },
        mascot: art ? await loadImage(Buffer.from(art.file.data)) : undefined,
        style,
      });
    }
    case 'leaderboard':
      return renderLeaderboard({
        title: 'Leaderboard',
        subtitle: `${community}, sample data`,
        rows: [1, 2, 3, 4, 5].map((rank) => ({
          rank,
          name: rank === 2 ? user.displayName : `Member ${rank}`,
          avatar: face,
          value: `Level ${36 - rank * 3}`,
          detail: `${(52_000 - rank * 4_100).toLocaleString('en-US')} XP`,
          highlight: rank === 2,
        })),
        style,
      });
  }
}
