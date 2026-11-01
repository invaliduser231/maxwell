import { moderationConfig } from '@maxwell/core/modules/moderation';
import { describe, expect, it } from 'vitest';
import type { GuildContext } from '../../src/commands/types.js';
import { massBanCommand } from '../../src/modules/moderation/commands/massban.js';
import { Confirmations } from '../../src/modules/moderation/confirm.js';
import { massBan } from '../../src/modules/moderation/massban.js';
import { ActionError, type ModerationService } from '../../src/modules/moderation/service.js';
import type { MemberRef, Outgoing, RoleRef } from '../../src/platform/types.js';

const guild = '900000000000000001';
const self = '100000000000000001';
const mod = '300000000000000001';
const plain = ['500000000000000001', '500000000000000002', '500000000000000003'];
const boss = '500000000000000009';
const banned = '500000000000000008';
const broken = '500000000000000007';

const roles: RoleRef[] = [
  { id: 'r-low', position: 1 },
  { id: 'r-mod', position: 5 },
  { id: 'r-bot', position: 9 },
  { id: 'r-boss', position: 6 },
] as RoleRef[];

const memberOf = (id: string): MemberRef | null => {
  const ids: Record<string, string[]> = {
    [self]: ['r-bot'],
    [mod]: ['r-mod'],
    [boss]: ['r-boss'],
    [plain[0] as string]: ['r-low'],
  };
  const list = ids[id];
  return list ? ({ userId: id, roles: list, timeoutUntil: null } as unknown as MemberRef) : null;
};

function setup(config = moderationConfig.parse({ logChannelId: '800' })) {
  const acted: { userId: string; reason: string | null; deleteMessageSeconds?: number | null }[] =
    [];
  const sent: { channel: string; message: Outgoing }[] = [];
  const edits: string[] = [];
  const confirmations = new Confirmations();
  let next = 10;
  const platform = {
    selfId: self,
    member: async (_g: string, id: string) => memberOf(id),
    roles: async () => roles,
    hasPermissions: async () => false,
    send: async (channel: string, message: Outgoing) => {
      sent.push({ channel, message });
      return 'log';
    },
    react: async (_c: string, messageId: string, emoji: string) => {
      setTimeout(() =>
        confirmations.handle({
          guildId: guild,
          channelId: '600',
          messageId,
          userId: mod,
          emoji,
          bot: false,
        }),
      );
    },
    unreact: async () => {},
    edit: async (_c: string, _m: string, content: string) => void edits.push(content),
  };
  const moderation = {
    services: { platform, log: { warn: () => {}, info: () => {} }, sql: {} },
    config: async () => config,
    store: {
      openCase: async (_g: string, id: string) => (id === banned ? { number: 1 } : null),
    },
    act: async (input: {
      userId: string;
      reason: string | null;
      deleteMessageSeconds?: number | null;
      quiet?: boolean;
    }) => {
      expect(input.quiet).toBe(true);
      if (input.userId === broken) throw new ActionError(403, 'ban', new Error('nope'));
      acted.push(input);
      next += 1;
      return { row: { number: next } };
    },
  } as unknown as ModerationService;
  return { moderation, platform, acted, sent, edits, confirmations };
}

describe('mass ban', () => {
  it('bans each member with one case each and skips what single bans refuse', async () => {
    const { moderation, acted, sent } = setup();
    const progress: number[] = [];
    const result = await massBan(
      moderation,
      {
        guildId: guild,
        userIds: [...plain, boss, banned, broken, mod, self],
        moderatorId: mod,
        reason: 'raid',
        deleteMessageSeconds: null,
        source: 'command',
        batch: 'b1',
      },
      (done) => void progress.push(done),
    );
    expect(acted.map((entry) => entry.userId)).toEqual(plain);
    expect(result.banned.map((entry) => entry.number)).toEqual([11, 12, 13]);
    expect(result.skipped).toEqual([
      { userId: boss, why: 'higher' },
      { userId: banned, why: 'banned' },
      { userId: mod, why: 'self' },
      { userId: self, why: 'me' },
    ]);
    expect(result.failed).toEqual([broken]);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.channel).toBe('800');
  });

  it('posts no summary when nobody was banned', async () => {
    const { moderation, sent } = setup();
    const result = await massBan(moderation, {
      guildId: guild,
      userIds: [boss],
      moderatorId: mod,
      reason: null,
      deleteMessageSeconds: null,
      source: 'dashboard',
      batch: 'b2',
    });
    expect(result.banned).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe('massban command', () => {
  function context(text: string, harness: ReturnType<typeof setup>) {
    const replies: Outgoing[] = [];
    const ctx = {
      guildId: guild,
      prefix: 'm!',
      path: ['massban'],
      seed: 1,
      message: { id: 'msg', channelId: '600', author: { id: mod } },
      args: { string: () => text, number: () => undefined },
      platform: harness.platform,
      services: {
        voice: {
          icon: () => '',
          icons: { reaction: () => 'ok' },
          usage: (problem: string) => problem,
        },
      },
      reply: async (out: Outgoing) => {
        replies.push(out);
        return 'prompt';
      },
    } as unknown as GuildContext;
    return { ctx, replies };
  }

  it('asks first, then bans with the expanded template', async () => {
    const harness = setup(
      moderationConfig.parse({
        reasonTemplates: [{ key: 'raid', text: 'Raid account', deleteMessages: true }],
      }),
    );
    const command = massBanCommand(harness.moderation, harness.confirmations);
    const { ctx, replies } = context(`${plain[0]} <@${plain[1]}> raid`, harness);
    await command.run?.(ctx);
    expect(String(replies[0])).toContain('**2 members**');
    expect(String(replies[0])).toContain('Raid account');
    expect(harness.acted).toEqual([
      expect.objectContaining({
        userId: plain[0],
        reason: 'Raid account',
        deleteMessageSeconds: 86_400,
      }),
      expect.objectContaining({ userId: plain[1], reason: 'Raid account' }),
    ]);
    expect(harness.edits.at(-1)).toContain('Banned 2 of 2 members.');
    expect(harness.edits.at(-1)).toContain('Cases #11 to #12.');
  });

  it('does nothing without a confirmation', async () => {
    const harness = setup();
    harness.platform.react = async () => {
      setTimeout(() => harness.confirmations.stop());
    };
    const command = massBanCommand(harness.moderation, harness.confirmations);
    const { ctx } = context(plain.join(' '), harness);
    await command.run?.(ctx);
    expect(harness.acted).toEqual([]);
    expect(harness.edits).toEqual(['No answer, so nobody was banned.']);
  });

  it('refuses lists above the cap and empty lists', async () => {
    const harness = setup();
    const command = massBanCommand(harness.moderation, harness.confirmations);
    const many = Array.from({ length: 201 }, (_, i) => String(600000000000000000n + BigInt(i)));
    const big = context(many.join(' '), harness);
    await command.run?.(big.ctx);
    expect(big.replies[0]).toMatchObject({
      content: "That's more than 200 members. Split the list.",
    });
    const none = context('just words', harness);
    await command.run?.(none.ctx);
    expect(String((none.replies[0] as { content: string }).content)).toContain(
      'Name at least one member',
    );
    expect(harness.acted).toEqual([]);
  });
});
