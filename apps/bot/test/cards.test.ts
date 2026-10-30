import { describe, expect, it } from 'vitest';
import { placeholder } from '../src/cards/avatar.js';
import { renderDigest } from '../src/cards/digest.js';
import { renderLeaderboard } from '../src/cards/leaderboard.js';
import { renderLevelUp } from '../src/cards/levelup.js';
import { renderRank } from '../src/cards/rank.js';
import { defaultTheme } from '../src/cards/theme.js';
import { renderWelcome } from '../src/cards/welcome.js';
import { withLanguage } from '../src/i18n/language.js';

const PNG = [0x89, 0x50, 0x4e, 0x47];

function isPng(buffer: Buffer): boolean {
  return PNG.every((byte, i) => buffer[i] === byte);
}

describe('cards', async () => {
  const face = await placeholder('Lena', defaultTheme);

  it('renders a rank card even with absurd values', async () => {
    const png = await renderRank({
      name: 'x'.repeat(200),
      username: 'y'.repeat(80),
      avatar: face,
      level: 9_999,
      rank: 1_000_000,
      xp: 5,
      needed: 0,
    });
    expect(isPng(png)).toBe(true);
  });

  it('renders level up, welcome, goodbye and leaderboard cards', async () => {
    const pngs = await Promise.all([
      renderLevelUp({ name: 'Lena', avatar: face, level: 5 }),
      renderWelcome({
        kind: 'welcome',
        title: 'Welcome, Lena',
        subtitle: 'Member #1',
        avatar: face,
      }),
      renderWelcome({
        kind: 'goodbye',
        title: 'Goodbye, Lena',
        subtitle: 'Down to 0',
        avatar: face,
      }),
      renderLeaderboard({
        title: 'Leaderboard',
        subtitle: 'Test',
        rows: [{ rank: 1, name: 'Lena', avatar: face, value: 'Level 3' }],
      }),
    ]);
    expect(pngs.every(isPng)).toBe(true);
  });

  it('renders a weekly digest with and without a previous week', async () => {
    const week = {
      community: 'z'.repeat(300),
      from: new Date(Date.UTC(2026, 9, 19)),
      to: new Date(Date.UTC(2026, 9, 26)),
      current: {
        joins: 1_000_000_000,
        leaves: 0,
        messages: 123_456_789,
        active: 3,
        moderation: { warn: 2, timeout: 0, kick: 1, ban: 0 },
      },
      previous: {
        joins: 0,
        leaves: 4,
        messages: 0,
        active: 3,
        moderation: { warn: 0, timeout: 0, kick: 0, ban: 0 },
      },
      inbox: 12,
      channels: [
        { name: 'c'.repeat(120), count: 5 },
        { name: null, count: 0 },
      ],
    };
    const pngs = await Promise.all([
      renderDigest(week),
      renderDigest({ ...week, previous: null, channels: [] }),
      withLanguage('de', () => renderDigest(week)),
    ]);
    expect(pngs.every(isPng)).toBe(true);
  });
});
