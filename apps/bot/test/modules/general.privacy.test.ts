import { describe, expect, it } from 'vitest';
import type { GuildContext } from '../../src/commands/types.js';
import { privacyCommands } from '../../src/modules/general/privacy.js';
import { Confirmations } from '../../src/modules/moderation/confirm.js';
import type { Outgoing } from '../../src/platform/types.js';

function setup(confirm?: string) {
  const replies: string[] = [];
  const edits: string[] = [];
  const forgotten: string[] = [];
  const confirmations = new Confirmations();
  const [, forgetme] = privacyCommands(confirmations);
  const ctx = {
    guildId: '100000000000000001',
    prefix: '!',
    seed: 1,
    message: { author: { id: '300000000000000001' }, channelId: '700000000000000001' },
    args: { string: () => confirm },
    reply: async (out: Outgoing) => {
      replies.push(typeof out === 'string' ? out : (out.content ?? ''));
      return '800000000000000001';
    },
    services: {
      privacy: {
        forget: async (_g: string, userId: string) => {
          forgotten.push(userId);
          return [];
        },
      },
      audit: { record: async () => {} },
      log: { error: () => {} },
      voice: {
        done: (text: string) => text,
        icons: { reaction: () => null, inline: () => '' },
      },
      platform: {
        react: async () => {},
        unreact: async () => {},
        edit: async (_c: string, _m: string, text: string) => {
          edits.push(text);
        },
      },
    },
  } as unknown as GuildContext;
  return { forgetme, ctx, replies, edits, forgotten, confirmations };
}

describe('forgetme', () => {
  it('asks first and deletes once the member reacts', async () => {
    const h = setup();
    const running = h.forgetme?.run?.(h.ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.replies[0]).toContain('forgetme confirm');
    expect(h.forgotten).toEqual([]);
    h.confirmations.handle({
      guildId: '100000000000000001',
      channelId: '700000000000000001',
      messageId: '800000000000000001',
      userId: '300000000000000001',
      emoji: '✅',
      bot: false,
    });
    await running;
    expect(h.forgotten).toEqual(['300000000000000001']);
    expect(h.edits).toHaveLength(1);
  });

  it('still works when typed with confirm', async () => {
    const h = setup('confirm');
    await h.forgetme?.run?.(h.ctx);
    expect(h.forgotten).toEqual(['300000000000000001']);
  });
});
