import type { JobInput } from '@maxwell/core';
import { automodConfig } from '@maxwell/core/modules/automod';
import type { AutomodStore, HitInput, StoredMessage } from '@maxwell/core/stores/automod';
import { describe, expect, it } from 'vitest';
import { Enforcer, MODERATION_ACTION } from '../../src/modules/automod/enforce.js';
import { MessageHistory } from '../../src/modules/automod/history.js';
import type { IncomingMessage, Outgoing } from '../../src/platform/types.js';
import type { ModuleContext } from '../../src/runtime/module.js';

const GUILD = '900000000000000001';
const USER = '300000000000000001';
const CHANNEL = '700000000000000001';

function incoming(id: string): IncomingMessage {
  return {
    id,
    channelId: CHANNEL,
    guildId: GUILD,
    content: 'THIS IS VERY LOUD',
    author: {
      id: USER,
      username: 'lena',
      displayName: 'Lena',
      bot: false,
      avatarUrl: '',
    },
    memberRoles: [],
    fromWebhook: false,
    attachments: [],
    embeds: [],
    mentionUsers: [],
    mentionRoles: [],
    mentionEveryone: false,
    replyTo: null,
    createdAt: new Date(),
  };
}

function setup(options: { moderation: boolean; enqueueFails?: boolean }) {
  const sent: { channelId: string; message: Outgoing }[] = [];
  const jobs: JobInput[] = [];
  const records: string[] = [];
  const hits: HitInput[] = [];
  const ctx = {
    services: {
      platform: {
        delete: async () => {},
        send: async (channelId: string, message: Outgoing) => {
          sent.push({ channelId, message });
          return '1';
        },
        guild: async () => ({ id: GUILD, name: 'Club', memberCount: 1, iconUrl: null }),
        sendDirect: async () => true,
      },
      log: { warn: () => {} },
      voice: { icon: () => '' },
      settings: {
        enabled: async (_guild: string, key: string) => key === 'moderation' && options.moderation,
      },
      jobs: {
        enqueue: async (job: JobInput) => {
          if (options.enqueueFails) throw new Error('db down');
          jobs.push(job);
          return 'job-1';
        },
      },
    },
    record: async (_guild: string, _actor: unknown, action: string) => {
      records.push(action);
      return '1';
    },
  } as unknown as ModuleContext<typeof automodConfig>;
  const store = {
    recordHits: async (input: readonly HitInput[]) => {
      hits.push(...input);
    },
  } as unknown as AutomodStore;
  const config = automodConfig.parse({
    rules: { caps: { mode: 'enforce', action: 'warn', deleteMessage: false } },
  });
  return { enforcer: new Enforcer(ctx, store), config, sent, jobs, records, hits };
}

describe('AutoMod warnings', () => {
  it('files a moderation warning when the moderation module is on', async () => {
    const { enforcer, config, sent, jobs, records, hits } = setup({ moderation: true });
    await enforcer.apply(incoming('510000000000000001'), GUILD, config, [
      { rule: 'caps', detail: '90% capitals' },
    ]);
    expect(jobs).toEqual([
      {
        kind: MODERATION_ACTION,
        guildId: GUILD,
        payload: {
          action: 'warn',
          userId: USER,
          moderatorId: null,
          reason: 'AutoMod: Caps, 90% capitals',
          source: 'automod',
        },
        dedupeKey: `automod.warn:${GUILD}:510000000000000001`,
      },
    ]);
    expect(sent).toEqual([]);
    expect(records).toEqual([]);
    expect(hits).toHaveLength(1);
  });

  it('falls back to the channel notice when moderation is off', async () => {
    const { enforcer, config, sent, jobs, records } = setup({ moderation: false });
    await enforcer.apply(incoming('510000000000000002'), GUILD, config, [
      { rule: 'caps', detail: '90% capitals' },
    ]);
    expect(jobs).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.channelId).toBe(CHANNEL);
    expect(records).toEqual(['automod.warn']);
  });

  it('falls back when the hand-off fails', async () => {
    const { enforcer, config, sent, records } = setup({ moderation: true, enqueueFails: true });
    await enforcer.apply(incoming('510000000000000003'), GUILD, config, [
      { rule: 'caps', detail: '90% capitals' },
    ]);
    expect(sent).toHaveLength(1);
    expect(records).toEqual(['automod.warn']);
  });
});

describe('MessageHistory', () => {
  it('drops buffered messages of a forgotten member', async () => {
    const saved: StoredMessage[] = [];
    const store = {
      saveMessages: async (batch: readonly StoredMessage[]) => {
        saved.push(...batch);
      },
    } as unknown as AutomodStore;
    const history = new MessageHistory(store, { warn: () => {} } as never);
    const base = {
      guildId: GUILD,
      channelId: CHANNEL,
      authorRoles: [],
      authorBot: false,
      mentionUsers: 0,
      mentionRoles: 0,
      createdAt: new Date(),
    };
    history.add({ ...base, messageId: '1', authorId: USER, content: 'mine' });
    history.add({ ...base, messageId: '2', authorId: '300000000000000002', content: 'theirs' });
    history.add({ ...base, guildId: '1', messageId: '3', authorId: USER, content: 'elsewhere' });
    await history.forget(GUILD, USER);
    await history.flush();
    expect(saved.map((row) => row.content).sort()).toEqual(['elsewhere', 'theirs']);
  });
});
