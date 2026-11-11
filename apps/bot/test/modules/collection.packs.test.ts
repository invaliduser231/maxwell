import { collectionConfig } from '@maxwell/core/modules/collection';
import { describe, expect, it } from 'vitest';
import type { GuildContext } from '../../src/commands/types.js';
import { listPacks } from '../../src/modules/collection/packs.js';
import type { Collection } from '../../src/modules/collection/service.js';
import type { Outgoing } from '../../src/platform/types.js';

const config = collectionConfig.parse({
  decks: [{ id: 'lol', name: 'League of Legends' }],
  packs: [
    { id: 'bronze', name: 'Bronze', price: 500, size: 3, deckId: 'lol' },
    { id: 'gold', name: 'Gold', price: 0, size: 5, guaranteed: 'epic' },
    { id: 'old', name: 'Old', price: 10, enabled: false },
  ],
});

function setup(held: { kind: string; ref: string; quantity: number }[]) {
  const replies: Outgoing[] = [];
  const collection = {
    config: async () => config,
    wallets: {
      store: { inventory: async () => held },
      config: async () => ({ currency: { name: 'coins', singular: 'coin', symbol: 'c' } }),
    },
  } as unknown as Collection;
  const ctx = {
    guildId: '100000000000000001',
    prefix: '!',
    message: { author: { id: '300000000000000001' } },
    reply: async (out: Outgoing) => {
      replies.push(out);
      return '1';
    },
  } as unknown as GuildContext;
  return { collection, ctx, replies };
}

describe('card packs list', () => {
  it('shows enabled packs with price, size, deck and what the member owns', async () => {
    const { collection, ctx, replies } = setup([{ kind: 'pack', ref: 'bronze', quantity: 2 }]);
    await listPacks(ctx, collection);
    const reply = replies[0];
    const text = typeof reply === 'string' ? reply : (reply?.embeds?.[0]?.description ?? '');
    expect(text).toContain('**Bronze**');
    expect(text).toContain('**500** coins, 3 cards, from League of Legends, you have 2 unopened');
    expect(text).toContain('free, 5 cards, from every deck, at least one Epic');
    expect(text).not.toContain('Old');
    expect(text).toContain('`!cards pack bronze`');
  });

  it('says so when there are no packs', async () => {
    const { collection, ctx, replies } = setup([]);
    config.packs.forEach((pack) => {
      pack.enabled = false;
    });
    await listPacks(ctx, collection);
    expect(replies[0]).toMatchObject({ content: expect.stringContaining('No packs here yet') });
  });
});
