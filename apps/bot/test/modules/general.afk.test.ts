import type { Afk, AfkStore } from '@maxwell/core/stores/afk';
import { describe, expect, it } from 'vitest';
import { AfkTracker } from '../../src/modules/general/afk.js';
import type { IncomingMessage, OutgoingMessage } from '../../src/platform/types.js';
import type { Services } from '../../src/services.js';

const guild = '100000000000000001';
const lena = '300000000000000001';
const max = '300000000000000002';

class MemoryStore {
  readonly rows = new Map<string, Afk>();
  async set(_guild: string, userId: string, reason: string) {
    this.rows.set(userId, { userId, reason, since: new Date(Date.now() - 2 * 3_600_000) });
  }
  async clear(_guild: string, userId: string) {
    const row = this.rows.get(userId) ?? null;
    this.rows.delete(userId);
    return row;
  }
  async get(_guild: string, ids: readonly string[]) {
    return ids.flatMap((id) => this.rows.get(id) ?? []);
  }
  async users() {
    return [...this.rows.keys()];
  }
}

function setup(disabled: string[] = []) {
  const replies: OutgoingMessage[] = [];
  const services = {
    settings: { config: async () => ({ disabledCommands: disabled }) },
    guilds: { prefix: async () => 'm!' },
    platform: {
      reply: async (_message: IncomingMessage, out: OutgoingMessage) => {
        replies.push(out);
        return 'r';
      },
    },
  } as unknown as Services;
  const store = new MemoryStore();
  const tracker = new AfkTracker(services, store as unknown as AfkStore);
  return { tracker, store, replies };
}

const message = (author: string, content: string, mentionUsers: string[] = []) =>
  ({
    id: '900000000000000001',
    channelId: '200000000000000001',
    guildId: guild,
    content,
    author: { id: author, username: 'x', displayName: 'X', bot: false, avatarUrl: '' },
    memberRoles: [],
    fromWebhook: false,
    attachments: [],
    embeds: [],
    mentionUsers,
    mentionRoles: [],
    mentionEveryone: false,
    replyTo: null,
    createdAt: new Date(),
  }) satisfies IncomingMessage;

describe('afk', () => {
  it('answers mentions once per minute and keeps pings off', async () => {
    const { tracker, replies } = setup();
    await tracker.set(guild, lena, 'sleeping');
    await tracker.onMessage(message(max, `hey <@${lena}>`, [lena]));
    await tracker.onMessage(message(max, `again <@${lena}>`, [lena]));
    expect(replies).toHaveLength(1);
    expect(replies[0]?.content).toBe(`<@${lena}> has been away for 2 hours: sleeping`);
    expect(replies[0]?.mentionUsers).toEqual([]);
  });

  it('clears the note when the member writes, but not on the afk command', async () => {
    const { tracker, store, replies } = setup();
    await tracker.set(guild, lena, '');
    await tracker.onMessage(message(lena, 'm!afk sleeping'));
    expect(store.rows.has(lena)).toBe(true);
    await tracker.onMessage(message(lena, 'morning'));
    expect(store.rows.has(lena)).toBe(false);
    expect(replies.at(-1)?.content).toBe('Welcome back. You were away for 2 hours.');
  });

  it('stays quiet when the command is turned off', async () => {
    const { tracker, replies } = setup(['afk']);
    await tracker.set(guild, lena, '');
    await tracker.onMessage(message(max, 'hi', [lena]));
    expect(replies).toHaveLength(0);
  });
});
