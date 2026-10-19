import { createCanvas, type Image, loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { defaultStyle } from '../../src/cards/theme.js';
import { memberBackground, withBackground } from '../../src/modules/levels/background.js';
import { type CardPage, CardPager, step } from '../../src/modules/levels/board.js';
import type { OutgoingMessage, Platform, ReactionEvent } from '../../src/platform/types.js';
import { parseIconSet } from '../../src/ui/icons.js';

interface Call {
  kind: string;
  args: unknown[];
}

function fakePlatform(missing: string[] = []) {
  const calls: Call[] = [];
  const platform = {
    selfId: '900',
    async missingBotPermissions() {
      return missing;
    },
    async react(...args: unknown[]) {
      calls.push({ kind: 'react', args });
    },
    async unreact(...args: unknown[]) {
      calls.push({ kind: 'unreact', args });
    },
    async edit(channelId: string, messageId: string, message: OutgoingMessage) {
      calls.push({ kind: 'edit', args: [channelId, messageId, message] });
    },
  };
  return { platform: platform as unknown as Platform, calls };
}

function page(n: number, pages: number): CardPage {
  return { content: `page ${n}`, image: new Uint8Array([n]), pages };
}

function reaction(emoji: string, userId = '10', bot = false): ReactionEvent {
  return { guildId: '1', channelId: '2', messageId: '500', userId, emoji, bot };
}

async function started(pages: number, missing: string[] = []) {
  const { platform, calls } = fakePlatform(missing);
  const pager = new CardPager(platform, parseIconSet(''), 60_000);
  const rendered: number[] = [];
  const sent: CardPage[] = [];
  await pager.start({
    guildId: '1',
    channelId: '2',
    userId: '10',
    page: 1,
    render: async (n) => {
      rendered.push(n);
      return page(n, pages);
    },
    send: async (first) => {
      sent.push(first);
      return '500';
    },
  });
  return { pager, calls, rendered, sent };
}

describe('leaderboard pager', () => {
  it('wraps around in both directions', () => {
    expect(step(1, 3, 1)).toBe(2);
    expect(step(3, 3, 1)).toBe(1);
    expect(step(1, 3, -1)).toBe(3);
    expect(step(1, 1, 1)).toBe(1);
  });

  it('adds arrows and swaps the card for the person who asked', async () => {
    const { pager, calls, sent } = await started(3);
    expect(sent.map((p) => p.content)).toEqual(['page 1']);
    expect(calls.filter((c) => c.kind === 'react').map((c) => c.args[2])).toEqual([
      pager.prev,
      pager.next,
    ]);

    await pager.onReaction(reaction(pager.next));
    const edit = calls.find((c) => c.kind === 'edit');
    const message = edit?.args[2] as OutgoingMessage;
    expect(message.content).toBe('page 2');
    expect(message.files?.[0]?.name).toBe('leaderboard.png');
    expect(message.files?.[0]?.data).toEqual(new Uint8Array([2]));
    expect(calls.at(-1)).toEqual({ kind: 'unreact', args: ['2', '500', pager.next, '10'] });

    await pager.onReaction(reaction(pager.prev));
    await pager.onReaction(reaction(pager.prev));
    const contents = calls
      .filter((c) => c.kind === 'edit')
      .map((c) => (c.args[2] as OutgoingMessage).content);
    expect(contents).toEqual(['page 2', 'page 1', 'page 3']);
  });

  it('ignores other members, bots and other emoji', async () => {
    const { pager, calls } = await started(3);
    await pager.onReaction(reaction(pager.next, '11'));
    await pager.onReaction(reaction(pager.next, '10', true));
    await pager.onReaction(reaction('🎉'));
    expect(calls.some((c) => c.kind === 'edit')).toBe(false);
  });

  it('skips the arrows for a single page or without reaction rights', async () => {
    const single = await started(1);
    expect(single.pager.size).toBe(0);
    expect(single.calls).toEqual([]);
    const blocked = await started(4, ['AddReactions']);
    expect(blocked.pager.size).toBe(0);
    expect(blocked.calls).toEqual([]);
  });

  it('leaves reactions alone without manage rights', async () => {
    const { pager, calls } = await started(2, ['ManageMessages']);
    await pager.onReaction(reaction(pager.next));
    expect(calls.filter((c) => c.kind === 'unreact')).toEqual([]);
    expect(calls.filter((c) => c.kind === 'edit')).toHaveLength(1);
  });
});

describe('member backgrounds', () => {
  async function png(): Promise<Uint8Array> {
    const canvas = createCanvas(4, 4);
    canvas.getContext('2d').fillRect(0, 0, 4, 4);
    return canvas.encode('png');
  }

  it('uses the bought background as the card backdrop', async () => {
    const data = await png();
    const asked: string[] = [];
    const image = await memberBackground(
      { background: async () => 'shop:sunset' },
      {
        asset: async (guildId, key) => {
          asked.push(`${guildId}/${key}`);
          return data;
        },
      },
      '1',
      '10',
    );
    expect(asked).toEqual(['1/shop:sunset']);
    expect(image?.width).toBe(4);
    const style = withBackground(defaultStyle, image, 0.4);
    expect(style.backdrop).toMatchObject({ kind: 'image', dim: 0.4 });
    expect(style.theme).toBe(defaultStyle.theme);
  });

  it('falls back to the server style', async () => {
    const none = await memberBackground(
      { background: async () => null },
      { asset: async () => new Uint8Array() },
      '1',
      '10',
    );
    expect(none).toBeNull();
    const missing = await memberBackground(
      { background: async () => 'gone' },
      { asset: async () => null },
      '1',
      '10',
    );
    expect(missing).toBeNull();
    const broken = await memberBackground(
      { background: async () => 'broken' },
      { asset: async () => new Uint8Array([1, 2, 3]) },
      '1',
      '10',
    );
    expect(broken).toBeNull();
    expect(withBackground(defaultStyle, null, 0.5)).toBe(defaultStyle);
    const sample: Image = await loadImage(Buffer.from(await png()));
    expect(withBackground(defaultStyle, sample, 0.5).backdrop.kind).toBe('image');
  });
});
