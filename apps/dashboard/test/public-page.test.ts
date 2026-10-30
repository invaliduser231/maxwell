import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  loadPublicPage,
  type PublicEventSource,
  type PublicSettings,
  type PublicSources,
} from '../lib/public-page';

const guildId = '900000000000000003';
const now = Date.parse('2026-10-26T12:00:00Z');

function settings(patch: Partial<PublicSettings> = {}): PublicSettings {
  return {
    page: { enabled: true, description: 'Board games on Fridays', invite: 'abc123' },
    levels: true,
    events: true,
    curve: 'standard',
    ...patch,
  };
}

function event(
  id: string,
  startsAt: string,
  durationMinutes: number | null = 60,
): PublicEventSource {
  return {
    id,
    title: `Event ${id}`,
    startsAt: new Date(startsAt),
    durationMinutes,
    timezone: 'Europe/Berlin',
    location: id === '2' ? 'Main stage' : null,
  };
}

function sources(patch: Partial<PublicSources> = {}) {
  const calls: string[] = [];
  const base: PublicSources = {
    active: async () => true,
    settings: async () => settings(),
    guild: async () => {
      calls.push('guild');
      return { name: 'Tabletop', iconUrl: null, memberCount: 42 };
    },
    leaderboard: async (_, limit) => {
      calls.push(`leaderboard:${limit}`);
      return [
        { userId: '1', xp: 300 },
        { userId: '2', xp: 120 },
      ];
    },
    events: async () => {
      calls.push('events');
      return [
        event('1', '2026-10-26T10:00:00Z'),
        event('2', '2026-10-26T11:30:00Z'),
        event('3', '2026-10-27T18:00:00Z'),
      ];
    },
    profiles: async (ids) => {
      calls.push(`profiles:${ids.join(',')}`);
      return new Map([
        ['1', { name: 'Lena', avatar: 'https://example.com/lena.png', known: true }],
        ['2', { name: 'Former member', avatar: null, known: false }],
      ]);
    },
  };
  return { calls, sources: { ...base, ...patch } };
}

describe('public page loader', () => {
  it('builds the page with leaderboard and upcoming events', async () => {
    const { sources: src } = sources();
    const page = await loadPublicPage(guildId, src, now);
    assert.ok(page);
    assert.equal(page.name, 'Tabletop');
    assert.equal(page.memberCount, 42);
    assert.equal(page.description, 'Board games on Fridays');
    assert.equal(page.invite, 'https://fluxer.gg/abc123');
    assert.deepEqual(page.leaderboard, [
      {
        rank: 1,
        userId: '1',
        name: 'Lena',
        avatar: 'https://example.com/lena.png',
        level: 2,
        xp: 300,
      },
      { rank: 2, userId: '2', name: null, avatar: null, level: 1, xp: 120 },
    ]);
    assert.deepEqual(
      page.events?.map((entry) => entry.id),
      ['2', '3'],
    );
    assert.equal(page.events?.[0]?.startsAt, '2026-10-26T11:30:00.000Z');
    assert.equal(page.events?.[0]?.location, 'Main stage');
  });

  it('returns nothing when the page is off, the id is bad or Maxwell left', async () => {
    const off = sources({
      settings: async () => settings({ page: { enabled: false, description: '', invite: null } }),
    });
    assert.equal(await loadPublicPage(guildId, off.sources, now), null);
    assert.deepEqual(off.calls, []);

    const left = sources({ active: async () => false });
    assert.equal(await loadPublicPage(guildId, left.sources, now), null);
    assert.deepEqual(left.calls, []);

    const bad = sources();
    assert.equal(await loadPublicPage('../etc', bad.sources, now), null);
    assert.deepEqual(bad.calls, []);

    const gone = sources({ guild: async () => null });
    assert.equal(await loadPublicPage(guildId, gone.sources, now), null);
  });

  it('leaves out modules that are off', async () => {
    const { sources: src, calls } = sources({
      settings: async () =>
        settings({
          levels: false,
          events: false,
          page: { enabled: true, description: '', invite: null },
        }),
    });
    const page = await loadPublicPage(guildId, src, now);
    assert.equal(page?.leaderboard, null);
    assert.equal(page?.events, null);
    assert.equal(page?.invite, null);
    assert.deepEqual(calls, ['guild']);
  });

  it('asks for ten members and skips profiles for an empty board', async () => {
    const { sources: src, calls } = sources({ leaderboard: async () => [] });
    const page = await loadPublicPage(guildId, src, now);
    assert.deepEqual(page?.leaderboard, []);
    assert.ok(!calls.some((call) => call.startsWith('profiles')));

    const full = sources();
    await loadPublicPage(guildId, full.sources, now);
    assert.ok(full.calls.includes('leaderboard:10'));
  });
});
