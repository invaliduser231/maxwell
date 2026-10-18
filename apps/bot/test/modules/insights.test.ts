import { insightsConfig } from '@maxwell/core/modules/insights';
import type { InsightsBatch, InsightsStore } from '@maxwell/core/stores/insights';
import { describe, expect, it } from 'vitest';
import { InsightsBuffer, splitByDay, VoiceSessions } from '../../src/modules/insights/buffer.js';
import { InsightsCollector, nativeAction } from '../../src/modules/insights/collector.js';
import { nextSlot } from '../../src/modules/insights/recurring.js';
import { AuditAction, type AuditLogEvent, type IncomingMessage } from '../../src/platform/types.js';
import type { ModuleContext } from '../../src/runtime/module.js';

const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 9, 21, hour, minute));

function audit(patch: Partial<AuditLogEvent> = {}): AuditLogEvent {
  return {
    id: '1',
    guildId: 'g1',
    action: AuditAction.MemberBanAdd,
    actorId: 'mod',
    targetId: 'u9',
    reason: null,
    changes: [],
    ...patch,
  };
}

function message(patch: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: '1',
    channelId: 'c1',
    guildId: 'g1',
    content: 'hi',
    author: { id: 'u1', username: 'u', displayName: 'U', bot: false, avatarUrl: '' },
    memberRoles: [],
    fromWebhook: false,
    attachments: [],
    mentionUsers: [],
    mentionRoles: [],
    mentionEveryone: false,
    replyTo: null,
    createdAt: at(10, 5),
    embeds: [],
    ...patch,
  };
}

describe('nextSlot', () => {
  it('aligns to the next period with a slot key', () => {
    const slot = nextSlot('insights.flush', 60_000, 125_000);
    expect(slot).toEqual({ runAt: new Date(180_000), dedupeKey: 'insights.flush:3' });
  });
});

describe('InsightsBuffer', () => {
  it('rolls messages up per hour, channel and member', () => {
    const buffer = new InsightsBuffer();
    buffer.message('g1', 'c1', 'u1', at(10, 5));
    buffer.message('g1', 'c1', 'u1', at(10, 55));
    buffer.message('g1', 'c1', 'u2', at(11, 1));
    buffer.member('g1', at(10), 1, 0);
    buffer.member('g1', at(12), 0, 1);
    const batch = buffer.drain();
    expect(batch.messages).toEqual([
      { guildId: 'g1', hour: at(10), channelId: 'c1', count: 2 },
      { guildId: 'g1', hour: at(11), channelId: 'c1', count: 1 },
    ]);
    expect(batch.active).toEqual([
      { guildId: 'g1', day: '2026-10-21', userId: 'u1', count: 2 },
      { guildId: 'g1', day: '2026-10-21', userId: 'u2', count: 1 },
    ]);
    expect(batch.members).toEqual([{ guildId: 'g1', day: '2026-10-21', joins: 1, leaves: 1 }]);
    expect(buffer.size()).toBe(0);
  });

  it('restores a failed batch within its limit', () => {
    const buffer = new InsightsBuffer(2);
    buffer.message('g1', 'c1', 'u1', at(10));
    const batch = buffer.drain();
    buffer.message('g1', 'c1', 'u1', at(10));
    expect(buffer.restore(batch)).toBe(true);
    expect(buffer.drain().messages[0]?.count).toBe(2);
    const big: InsightsBatch = {
      messages: [],
      active: [],
      members: Array.from({ length: 5 }, (_, i) => ({
        guildId: `g${i}`,
        day: '2026-10-21',
        joins: 1,
        leaves: 0,
      })),
      voice: [],
    };
    expect(buffer.restore(big)).toBe(false);
  });
});

describe('native moderation', () => {
  it('counts bans and kicks by people and other bots, never by Maxwell', () => {
    expect(nativeAction(audit(), 'maxwell')).toBe('ban');
    expect(nativeAction(audit({ action: AuditAction.MemberKick }), 'maxwell')).toBe('kick');
    expect(nativeAction(audit({ actorId: null }), 'maxwell')).toBe('ban');
    expect(nativeAction(audit({ actorId: 'maxwell' }), 'maxwell')).toBeNull();
    expect(nativeAction(audit({ action: AuditAction.MemberBanRemove }), 'maxwell')).toBeNull();
    expect(nativeAction(audit({ action: AuditAction.RoleDelete }), null)).toBeNull();
  });

  it('rolls up per day, action and actor and survives a failed write', () => {
    const buffer = new InsightsBuffer();
    buffer.moderation('g1', at(10), 'ban', 'mod');
    buffer.moderation('g1', at(11), 'ban', 'mod');
    buffer.moderation('g1', at(11), 'kick', null);
    const batch = buffer.drain();
    expect(batch.moderation).toEqual([
      { guildId: 'g1', day: '2026-10-21', action: 'ban', actorId: 'mod', count: 2 },
      { guildId: 'g1', day: '2026-10-21', action: 'kick', actorId: null, count: 1 },
    ]);
    buffer.moderation('g1', at(12), 'ban', 'mod');
    expect(buffer.restore(batch)).toBe(true);
    expect(buffer.drain().moderation?.find((row) => row.action === 'ban')?.count).toBe(3);
  });

  it('forgets a member from the buffer but keeps the moderation count', () => {
    const buffer = new InsightsBuffer();
    buffer.message('g1', 'c1', 'u1', at(10));
    buffer.message('g1', 'c1', 'u2', at(10));
    buffer.moderation('g1', at(10), 'ban', 'u1');
    buffer.moderation('g1', at(10), 'ban', null);
    buffer.moderation('g2', at(10), 'kick', 'u1');
    buffer.forget('g1', 'u1');
    const batch = buffer.drain();
    expect(batch.active.map((row) => row.userId)).toEqual(['u2']);
    expect(batch.messages[0]?.count).toBe(2);
    expect(batch.moderation).toEqual([
      { guildId: 'g1', day: '2026-10-21', action: 'ban', actorId: null, count: 2 },
      { guildId: 'g2', day: '2026-10-21', action: 'kick', actorId: 'u1', count: 1 },
    ]);
  });
});

describe('voice sessions', () => {
  it('splits time at midnight', () => {
    const parts = splitByDay(Date.UTC(2026, 9, 21, 23, 30), Date.UTC(2026, 9, 22, 0, 15));
    expect(parts).toEqual([
      { day: '2026-10-21', seconds: 1800 },
      { day: '2026-10-22', seconds: 900 },
    ]);
  });

  it('accrues on leave, on move and on settle', () => {
    const sessions = new VoiceSessions();
    const start = at(10).getTime();
    expect(sessions.update('g1', 'u1', 'v1', start)).toEqual([]);
    expect(sessions.update('g1', 'u1', 'v1', start + 1000)).toEqual([]);
    expect(sessions.settle(start + 60_000)).toEqual([
      { guildId: 'g1', channelId: 'v1', day: '2026-10-21', seconds: 60 },
    ]);
    expect(sessions.update('g1', 'u1', 'v2', start + 90_000)).toEqual([
      { guildId: 'g1', channelId: 'v1', day: '2026-10-21', seconds: 30 },
    ]);
    expect(sessions.update('g1', 'u1', null, start + 150_000)).toEqual([
      { guildId: 'g1', channelId: 'v2', day: '2026-10-21', seconds: 60 },
    ]);
    expect(sessions.size()).toBe(0);
  });

  it('drops sessions older than a day after settling them', () => {
    const sessions = new VoiceSessions(10, 60_000);
    sessions.update('g1', 'u1', 'v1', 0);
    sessions.settle(30_000);
    expect(sessions.size()).toBe(1);
    sessions.settle(120_000);
    expect(sessions.size()).toBe(0);
  });

  it('stays bounded', () => {
    const sessions = new VoiceSessions(2);
    sessions.update('g1', 'a', 'v', 0);
    sessions.update('g1', 'b', 'v', 0);
    sessions.update('g1', 'c', 'v', 0);
    expect(sessions.size()).toBe(2);
  });
});

describe('InsightsCollector', () => {
  function setup(config = insightsConfig.parse({}), enabled = true) {
    const written: InsightsBatch[] = [];
    let fail = false;
    const store = {
      write: async (batch: InsightsBatch) => {
        if (fail) throw new Error('db down');
        written.push(batch);
        return (
          batch.messages.length + batch.active.length + batch.members.length + batch.voice.length
        );
      },
    } as unknown as InsightsStore;
    const ctx = {
      services: {
        platform: { selfId: 'maxwell' },
        log: { warn: () => {}, debug: () => {}, info: () => {}, error: () => {} },
      },
      config: async () => config,
      enabled: async () => enabled,
    } as unknown as ModuleContext<typeof insightsConfig>;
    let now = at(10).getTime();
    const collector = new InsightsCollector(ctx, store, 1000, () => now);
    return {
      collector,
      written,
      setFail: (value: boolean) => {
        fail = value;
      },
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it('skips bots, webhooks and excluded channels', async () => {
    const { collector, written } = setup(insightsConfig.parse({ excludedChannels: ['quiet'] }));
    await collector.onMessage(message());
    await collector.onMessage(message({ channelId: 'quiet' }));
    await collector.onMessage(message({ fromWebhook: true }));
    await collector.onMessage(
      message({ author: { id: 'b', username: 'b', displayName: 'b', bot: true, avatarUrl: '' } }),
    );
    await collector.flush();
    expect(written[0]?.messages).toEqual([
      { guildId: 'g1', hour: at(10), channelId: 'c1', count: 1 },
    ]);
  });

  it('keeps rows when the write fails and retries on the next flush', async () => {
    const { collector, written, setFail } = setup();
    await collector.onMessage(message());
    setFail(true);
    expect(await collector.flush()).toBe(0);
    setFail(false);
    expect(await collector.flush()).toBe(2);
    expect(written).toHaveLength(1);
  });

  it('buffers native bans and kicks from the audit log', async () => {
    const { collector, written } = setup();
    collector.onAudit(audit());
    collector.onAudit(audit({ action: AuditAction.MemberKick, actorId: 'otherbot' }));
    collector.onAudit(audit({ actorId: 'maxwell' }));
    await collector.flush();
    expect(written[0]?.moderation).toEqual([
      { guildId: 'g1', day: '2026-10-21', action: 'ban', actorId: 'mod', count: 1 },
      { guildId: 'g1', day: '2026-10-21', action: 'kick', actorId: 'otherbot', count: 1 },
    ]);
  });

  it('flushes before forgetting so pending rows cannot come back', async () => {
    const { collector, written } = setup();
    const forgotten: string[] = [];
    const store = (collector as unknown as { store: Record<string, unknown> }).store;
    store.forgetUser = async (guildId: string, userId: string) => {
      forgotten.push(`${guildId}:${userId}:${written.length}`);
    };
    await collector.onMessage(message());
    await collector.forget('g1', 'u1');
    expect(forgotten).toEqual(['g1:u1:1']);
    expect(collector.buffer.size()).toBe(0);
  });

  it('counts voice time only where tracking is on', async () => {
    const on = setup();
    await on.collector.onVoice({ guildId: 'g1', userId: 'u1', channelId: 'v1', before: null });
    on.advance(120_000);
    await on.collector.onVoice({ guildId: 'g1', userId: 'maxwell', channelId: 'v1', before: null });
    await on.collector.flush();
    expect(on.written[0]?.voice).toEqual([
      { guildId: 'g1', day: '2026-10-21', channelId: 'v1', seconds: 120 },
    ]);
    expect(on.collector.sessions.size()).toBe(1);

    const off = setup(insightsConfig.parse({ trackVoice: false }));
    await off.collector.onVoice({ guildId: 'g1', userId: 'u1', channelId: 'v1', before: null });
    off.advance(120_000);
    await off.collector.flush();
    expect(off.written).toHaveLength(0);
  });
});
