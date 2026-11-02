import type { InsightsStore } from '@maxwell/core/stores/insights';
import { describe, expect, it } from 'vitest';
import { fillDays, renderActivity } from '../../src/cards/activity.js';
import { Args } from '../../src/commands/args.js';
import type { Command, GuildContext } from '../../src/commands/types.js';
import { createLogger } from '../../src/log.js';
import { lastDays, statsCommand } from '../../src/modules/insights/commands.js';
import type { Outgoing, Platform } from '../../src/platform/types.js';

const guild = '900000000000000050';
const author = '420000000000000001';
const other = '420000000000000002';

describe('activity days', () => {
  it('covers the last days up to and including today', () => {
    const range = lastDays(30, Date.parse('2026-11-02T20:15:00Z'));
    expect(range.from.toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-11-03T00:00:00.000Z');
  });

  it('fills days without activity with zeros', () => {
    const days = fillDays(
      '2026-10-30',
      4,
      [{ at: '2026-10-31', messages: 12 }],
      [{ day: '2026-11-02', joins: 3, leaves: 1 }],
    );
    expect(days).toEqual([
      { day: '2026-10-30', messages: 0, joins: 0, leaves: 0 },
      { day: '2026-10-31', messages: 12, joins: 0, leaves: 0 },
      { day: '2026-11-01', messages: 0, joins: 0, leaves: 0 },
      { day: '2026-11-02', messages: 0, joins: 3, leaves: 1 },
    ]);
  });

  it('draws a card even for a quiet community', async () => {
    const image = await renderActivity({
      community: 'Quiet',
      days: fillDays('2026-10-30', 7, [], []),
      messages: 0,
      active: 0,
      joins: 0,
      leaves: 0,
      voiceMinutes: 0,
    });
    expect(image.subarray(1, 4).toString()).toBe('PNG');
  });
});

describe('stats command', () => {
  let flushed = 0;
  const store = {
    summary: async () => ({
      messages: 40,
      activeMembers: 5,
      joins: 2,
      leaves: 1,
      voiceMinutes: 90,
      moderationActions: 0,
    }),
    messages: async () => [{ at: '2026-11-01', messages: 40 }],
    memberFlow: async () => [],
    topChannels: async () => [{ channelId: '510000000000000001', count: 40 }],
    topVoiceChannels: async () => [],
    topMembers: async () => [{ userId: author, count: 40 }],
    member: async () => ({
      activity: [
        { day: '2020-01-01', messages: 9 },
        { day: new Date().toISOString().slice(0, 10), messages: 4 },
      ],
      moderation: [],
    }),
  } as unknown as InsightsStore;
  const command = statsCommand(store, async () => {
    flushed++;
  });

  async function run(
    target: Command | undefined,
    values: [string, string | number][] = [],
    moderator = false,
  ): Promise<Outgoing[]> {
    const replies: Outgoing[] = [];
    const platform = {
      guild: async () => ({ id: guild, name: 'Lounge', memberCount: 10, iconUrl: null }),
      user: async (id: string) => ({ id, displayName: `user ${id}`, avatarUrl: '' }),
      hasPermissions: async () => moderator,
    };
    const ctx = {
      message: { id: '1', channelId: '2', author: { id: author } },
      guildId: guild,
      prefix: 'm!',
      path: ['stats'],
      args: new Args(new Map(values)),
      services: {
        platform,
        log: createLogger('silent', false),
        cards: { forGuild: async () => undefined },
      },
      platform: platform as unknown as Platform,
      seed: { seed: '1', scope: '2' },
      reply: async (out: Outgoing) => {
        replies.push(out);
        return '3';
      },
    } as unknown as GuildContext;
    if (target?.guildOnly) await target.run?.(ctx);
    return replies;
  }

  const sub = (name: string) => command.subcommands?.find((entry) => entry.name === name);

  it('replies with the activity card', async () => {
    const [reply] = await run(command, [['days', 7]]);
    expect(typeof reply === 'object' && 'files' in reply && reply.files?.[0]?.name).toBe(
      'activity.png',
    );
    expect(flushed).toBeGreaterThan(0);
  });

  it('lists the busiest channels', async () => {
    const [reply] = await run(sub('channels'));
    expect(JSON.stringify(reply)).toContain('<#510000000000000001>');
    expect(JSON.stringify(reply)).toContain('40 messages');
  });

  it('only counts the recent days of a member', async () => {
    const [reply] = await run(sub('user'));
    expect(JSON.stringify(reply)).toContain('4 messages on 1 of the last 30 days');
  });

  it('keeps other members private from non moderators', async () => {
    const [denied] = await run(sub('user'), [['user', other]]);
    expect(denied).toBe('Only moderators can look up other members.');
    const [allowed] = await run(sub('user'), [['user', other]], true);
    expect(JSON.stringify(allowed)).toContain(`user ${other}`);
  });
});
