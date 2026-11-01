import { type AutomodConfig, automodConfig } from '@maxwell/core/modules/automod';
import type { SlowmodeHold, SlowmodeStore } from '@maxwell/core/stores/slowmode';
import { describe, expect, it } from 'vitest';
import {
  AdaptiveSlowmode,
  type Held,
  nextSlowmode,
  RateCounter,
  type SlowmodeSettings,
} from '../../src/modules/automod/slowmode.js';
import type { ChannelRef, Outgoing } from '../../src/platform/types.js';
import type { ModuleContext } from '../../src/runtime/module.js';

const GUILD = '900000000000000001';
const CHANNEL = '700000000000000001';
const LOG = '700000000000000009';

const settings: SlowmodeSettings = {
  maxPerMinute: 30,
  minSeconds: 5,
  maxSeconds: 30,
  stepSeconds: 5,
  cooldownSeconds: 120,
};

function held(applied: number, original = 0, changedAt = 0): Held {
  return { original, applied, changedAt };
}

describe('nextSlowmode', () => {
  const later = 10 * 60_000;

  it('does nothing while the channel is calm', () => {
    expect(nextSlowmode({ rate: 30, current: 0, held: null, settings, now: 0 })).toEqual({
      kind: 'none',
    });
  });

  it('starts at the minimum when the rate is over the target', () => {
    expect(nextSlowmode({ rate: 31, current: 0, held: null, settings, now: 0 })).toEqual({
      kind: 'raise',
      seconds: 5,
    });
  });

  it('builds on a slowmode that is already set', () => {
    expect(nextSlowmode({ rate: 50, current: 10, held: null, settings, now: 0 })).toEqual({
      kind: 'raise',
      seconds: 15,
    });
  });

  it('leaves channels alone that are already at the maximum', () => {
    expect(nextSlowmode({ rate: 90, current: 60, held: null, settings, now: 0 })).toEqual({
      kind: 'none',
    });
  });

  it('waits for the cool-down between changes', () => {
    const state = held(5, 0, 0);
    expect(nextSlowmode({ rate: 90, current: 5, held: state, settings, now: 60_000 })).toEqual({
      kind: 'none',
    });
    expect(nextSlowmode({ rate: 0, current: 5, held: state, settings, now: 60_000 })).toEqual({
      kind: 'none',
    });
    expect(nextSlowmode({ rate: 90, current: 5, held: state, settings, now: 120_000 })).toEqual({
      kind: 'raise',
      seconds: 10,
    });
  });

  it('stops at the maximum', () => {
    expect(nextSlowmode({ rate: 90, current: 30, held: held(30), settings, now: later })).toEqual({
      kind: 'none',
    });
    expect(nextSlowmode({ rate: 90, current: 28, held: held(28), settings, now: later })).toEqual({
      kind: 'raise',
      seconds: 30,
    });
  });

  it('holds between half the target and the target', () => {
    expect(nextSlowmode({ rate: 20, current: 15, held: held(15), settings, now: later })).toEqual({
      kind: 'none',
    });
  });

  it('steps down when calm and restores the original at the bottom', () => {
    expect(nextSlowmode({ rate: 10, current: 15, held: held(15), settings, now: later })).toEqual({
      kind: 'lower',
      seconds: 10,
    });
    expect(nextSlowmode({ rate: 0, current: 5, held: held(5), settings, now: later })).toEqual({
      kind: 'restore',
      seconds: 0,
    });
    expect(
      nextSlowmode({ rate: 0, current: 15, held: held(15, 10), settings, now: later }),
    ).toEqual({ kind: 'restore', seconds: 10 });
  });

  it('copes with a maximum below the minimum', () => {
    const odd = { ...settings, minSeconds: 20, maxSeconds: 10 };
    expect(nextSlowmode({ rate: 90, current: 0, held: null, settings: odd, now: 0 })).toEqual({
      kind: 'raise',
      seconds: 20,
    });
  });
});

describe('RateCounter', () => {
  it('counts messages in the last minute', () => {
    const counter = new RateCounter();
    for (let i = 0; i < 10; i++) counter.add('a', i * 10_000);
    expect(counter.rate('a', 90_000)).toBe(6);
    expect(counter.rate('a', 200_000)).toBe(0);
    expect(counter.rate('b', 0)).toBe(0);
  });

  it('drops the oldest channel when full', () => {
    const counter = new RateCounter(2);
    counter.add('a', 0);
    counter.add('b', 0);
    counter.add('c', 0);
    expect(counter.rate('a', 1)).toBe(0);
    expect(counter.rate('c', 1)).toBe(1);
  });
});

function setup(initial: SlowmodeHold[] = [], live = 0) {
  const channel: { value: number } = { value: live };
  const edits: number[] = [];
  const sent: string[] = [];
  const rows = new Map<string, SlowmodeHold>(initial.map((row) => [row.channelId, row]));
  let config: AutomodConfig = automodConfig.parse({
    logChannelId: LOG,
    slowmode: {
      enabled: true,
      channelIds: [CHANNEL],
      maxPerMinute: 5,
      minSeconds: 5,
      maxSeconds: 15,
      stepSeconds: 5,
      cooldownSeconds: 30,
    },
  });
  const ctx = {
    config: async () => config,
    enabled: async () => true,
    services: {
      platform: {
        channels: async () => [{ id: CHANNEL, rateLimitPerUser: channel.value } as ChannelRef],
        editChannel: async (_id: string, input: { rateLimitPerUser?: number }) => {
          channel.value = input.rateLimitPerUser ?? channel.value;
          edits.push(channel.value);
        },
        send: async (channelId: string, message: Outgoing) => {
          if (channelId !== LOG) return '1';
          sent.push(typeof message === 'string' ? message : (message.content ?? ''));
          return '1';
        },
      },
      log: { warn: () => {} },
    },
  } as unknown as ModuleContext<typeof automodConfig>;
  const store = {
    all: async () => [...rows.values()],
    save: async (hold: SlowmodeHold) => {
      const existing = rows.get(hold.channelId);
      rows.set(hold.channelId, { ...hold, original: existing?.original ?? hold.original });
    },
    remove: async (_guild: string, channelId: string) => {
      rows.delete(channelId);
    },
  } as unknown as SlowmodeStore;
  const slowmode = new AdaptiveSlowmode(ctx, store);
  return {
    slowmode,
    channel,
    edits,
    sent,
    rows,
    get config() {
      return config;
    },
    setConfig(next: AutomodConfig) {
      config = next;
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe('AdaptiveSlowmode', () => {
  it('raises slowmode in a busy channel, then restores it when calm', async () => {
    const env = setup();
    await env.slowmode.load();
    for (let i = 0; i < 6; i++) env.slowmode.observe(GUILD, CHANNEL, env.config, 1_000 + i * 100);
    env.slowmode.observe(GUILD, CHANNEL, env.config, 7_000);
    await settle();
    expect(env.edits).toEqual([5]);
    expect(env.rows.get(CHANNEL)?.original).toBe(0);
    expect(env.sent[0]).toContain('raised to 5s');

    await env.slowmode.tick(20_000);
    expect(env.edits).toEqual([5]);
    await env.slowmode.tick(200_000);
    expect(env.edits).toEqual([5, 0]);
    expect(env.rows.size).toBe(0);
    expect(env.sent[1]).toContain('off again');
  });

  it('ignores channels that are not listed', async () => {
    const env = setup();
    await env.slowmode.load();
    for (let i = 0; i < 20; i++) env.slowmode.observe(GUILD, '1', env.config, 6_000 + i);
    await settle();
    expect(env.edits).toEqual([]);
  });

  it('lets go when someone else changes the slowmode', async () => {
    const env = setup(
      [{ guildId: GUILD, channelId: CHANNEL, original: 0, applied: 10, changedAt: new Date(0) }],
      10,
    );
    await env.slowmode.load();
    env.channel.value = 30;
    await env.slowmode.onChannelUpdate({
      guildId: GUILD,
      channel: { id: CHANNEL, rateLimitPerUser: 30 } as ChannelRef,
      before: null,
    });
    expect(env.slowmode.held).toBe(0);
    await env.slowmode.tick(10 * 60_000);
    expect(env.edits).toEqual([]);
  });

  it('does not restore over a value it did not set', async () => {
    const env = setup(
      [{ guildId: GUILD, channelId: CHANNEL, original: 0, applied: 10, changedAt: new Date(0) }],
      20,
    );
    await env.slowmode.load();
    await env.slowmode.tick(10 * 60_000);
    expect(env.edits).toEqual([]);
    expect(env.rows.size).toBe(0);
    expect(env.slowmode.held).toBe(0);
  });

  it('restores right away when the feature is turned off', async () => {
    const env = setup(
      [{ guildId: GUILD, channelId: CHANNEL, original: 3, applied: 10, changedAt: new Date() }],
      10,
    );
    await env.slowmode.load();
    env.setConfig(automodConfig.parse({ logChannelId: LOG }));
    await env.slowmode.tick();
    expect(env.edits).toEqual([3]);
    expect(env.sent[0]).toContain('back to 3s');
  });

  it('waits for the stored state before acting', async () => {
    const env = setup([], 0);
    for (let i = 0; i < 20; i++) env.slowmode.observe(GUILD, CHANNEL, env.config, 6_000 + i);
    await settle();
    expect(env.edits).toEqual([]);
  });
});
