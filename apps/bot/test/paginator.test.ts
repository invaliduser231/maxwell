import { describe, expect, it } from 'vitest';
import type { CommandContext } from '../src/commands/types.js';
import type { Platform, ReactionEvent } from '../src/platform/types.js';
import { chunk, Paginator, withPageFooter } from '../src/ui/paginator.js';

describe('paginator helpers', () => {
  it('splits lists into pages', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 10)).toEqual([]);
  });

  it('adds the page to the footer only when there is more than one', () => {
    expect(withPageFooter({ title: 'Top' }, 0, 1).footer).toBeUndefined();
    expect(withPageFooter({ title: 'Top' }, 1, 3).footer).toBe('Page 2 of 3');
    expect(withPageFooter({ footer: 'ID 1' }, 0, 2).footer).toBe('ID 1 / Page 1 of 2');
  });
});

describe('paginator picks', () => {
  it('adds number reactions and reports the page and slot that was picked', async () => {
    let listener: ((reaction: ReactionEvent) => void) | null = null;
    const reacted: string[] = [];
    const platform = {
      on: (_event: string, handler: (reaction: ReactionEvent) => void) => {
        listener = handler;
      },
      missingBotPermissions: async () => [],
      react: async (_c: string, _m: string, emoji: string) => {
        reacted.push(emoji);
      },
      unreact: async () => {},
      edit: async () => {},
    } as unknown as Platform;
    const pages = new Paginator(platform, { reaction: () => null, inline: () => '' });
    const picked: [number, number][] = [];
    const ctx = {
      guildId: '100000000000000001',
      message: { channelId: '700000000000000001', author: { id: '300000000000000001' } },
      reply: async () => '800000000000000001',
    } as unknown as CommandContext;
    await pages.send(ctx, [{ title: 'Shop' }, { title: 'Shop 2' }], 1, {
      picks: 3,
      onPick: (page, slot) => {
        picked.push([page, slot]);
      },
    });
    expect(reacted).toHaveLength(5);
    const press = (emoji: string, userId = '300000000000000001') =>
      listener?.({
        guildId: '100000000000000001',
        channelId: '700000000000000001',
        messageId: '800000000000000001',
        userId,
        emoji,
        bot: false,
      });
    press('2⃣');
    press('3️⃣', '300000000000000002');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(picked).toEqual([[1, 1]]);
  });
});
