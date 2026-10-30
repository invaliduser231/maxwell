import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadImage } from '@napi-rs/canvas';
import { placeholder } from '../src/cards/avatar.js';
import { renderDigest } from '../src/cards/digest.js';
import { renderLeaderboard } from '../src/cards/leaderboard.js';
import { renderLevelUp } from '../src/cards/levelup.js';
import { renderRank } from '../src/cards/rank.js';
import { assetsDir, defaultTheme, makeStyle } from '../src/cards/theme.js';
import { renderWelcome } from '../src/cards/welcome.js';
import { withLanguage } from '../src/i18n/language.js';

const out = process.argv[2] ?? join(assetsDir, 'previews');
mkdirSync(out, { recursive: true });

const face = await loadImage(join(assetsDir, 'png', 'brand', 'avatar.png'));
const happy = await loadImage(join(assetsDir, 'png', 'mascot', 'happy.png'));
const backdropImage = await loadImage(join(assetsDir, 'png', 'brand', 'banner.png'));
const names = [
  'Lena',
  'Maximilian Weber',
  'ada',
  'Tom',
  'Jo',
  'Noor',
  'Kai',
  'Mira',
  'Sam',
  'Elif',
];
const avatars = await Promise.all(names.map((name) => placeholder(name, defaultTheme)));

const week = {
  community: 'Example Community',
  from: new Date(Date.UTC(2026, 9, 19)),
  to: new Date(Date.UTC(2026, 9, 26)),
  current: {
    joins: 48,
    leaves: 13,
    messages: 12_840,
    active: 312,
    moderation: { warn: 7, timeout: 3, kick: 1, ban: 2 },
  },
  previous: {
    joins: 41,
    leaves: 19,
    messages: 11_020,
    active: 330,
    moderation: { warn: 4, timeout: 3, kick: 0, ban: 1 },
  },
  inbox: 4,
  channels: [
    { name: 'general', count: 6_210 },
    { name: 'help-and-questions-for-everyone', count: 2_904 },
    { name: null, count: 1_377 },
  ],
};

const cards: [string, Promise<Buffer>][] = [
  [
    'rank',
    renderRank({
      name: 'Lena Hoffmann',
      username: 'lena',
      avatar: face,
      level: 12,
      rank: 4,
      xp: 840,
      needed: 1_200,
    }),
  ],
  [
    'rank-long-name',
    renderRank({
      name: 'A really quite long display name that keeps going',
      username: 'someone_with_a_long_handle',
      avatar: avatars[1] ?? face,
      level: 108,
      rank: 1_204,
      xp: 12_480,
      needed: 98_000,
    }),
  ],
  [
    'levelup',
    renderLevelUp({
      name: 'Lena Hoffmann',
      avatar: face,
      level: 25,
      reward: { name: 'Regular', color: '#3A9EEA' },
      mascot: happy,
    }),
  ],
  [
    'welcome',
    renderWelcome({
      kind: 'welcome',
      title: 'Welcome, Lena',
      subtitle: 'Member #1,204 of Example Community',
      avatar: face,
    }),
  ],
  [
    'goodbye',
    renderWelcome({
      kind: 'goodbye',
      title: 'Goodbye, Lena',
      subtitle: 'Example Community is down to 1,203',
      avatar: face,
    }),
  ],
  [
    'leaderboard',
    renderLeaderboard({
      title: 'Leaderboard',
      subtitle: 'Example Community, all time',
      rows: names.map((name, i) => ({
        rank: i + 1,
        name,
        avatar: avatars[i] ?? face,
        value: `Level ${34 - i * 2}`,
        detail: `${(48_200 - i * 3_900).toLocaleString('en-US')} XP`,
        highlight: i === 3,
      })),
    }),
  ],
  [
    'welcome-image',
    renderWelcome({
      kind: 'welcome',
      title: 'Welcome, Lena',
      subtitle: 'Member #1,204 of Example Community',
      avatar: face,
      style: makeStyle('#3A9EEA', { kind: 'image', image: backdropImage, dim: 0.6 }),
    }),
  ],
  [
    'rank-plain-blue',
    renderRank({
      name: 'Lena Hoffmann',
      username: 'lena',
      avatar: face,
      level: 12,
      rank: 4,
      xp: 840,
      needed: 1_200,
      style: makeStyle('#3A9EEA', { kind: 'plain' }),
    }),
  ],
  ['digest', renderDigest(week)],
  ['digest-de', withLanguage('de', () => renderDigest(week))],
  [
    'digest-first-week',
    renderDigest({
      ...week,
      previous: null,
      inbox: 0,
      channels: [],
      current: { ...week.current, moderation: { warn: 0, timeout: 0, kick: 0, ban: 0 } },
      style: makeStyle('#3A9EEA', { kind: 'plain' }),
    }),
  ],
];

for (const [name, render] of cards) {
  writeFileSync(join(out, `${name}.png`), await render);
  console.log(join(out, `${name}.png`));
}
