import { economyConfig, type ShopItem } from '@maxwell/core/modules/economy';
import {
  cappedAmount,
  DAY_MS,
  dailyAmount,
  nextStreak,
  splitTax,
} from '@maxwell/core/stores/economy';
import { describe, expect, it } from 'vitest';
import { rollAmount, Throttle } from '../../src/modules/economy/earnings.js';
import { findItem, purchaseInput } from '../../src/modules/economy/shop.js';
import { money, short } from '../../src/modules/economy/wallets.js';

const items: ShopItem[] = economyConfig.parse({
  shop: [
    { id: 'vip', kind: 'role', name: 'VIP', price: 500, roleId: '123456789012345678' },
    { id: 'hidden', kind: 'giveaway', name: 'Hidden', price: 1, enabled: false },
    { id: 'starter', kind: 'pack', name: 'Starter pack', price: 250, packId: 'standard' },
    { id: 'sunset', kind: 'background', name: 'Sunset', price: 900, assetKey: 'bg-sunset' },
  ],
}).shop;

describe('economy config', () => {
  it('parses an empty config with defaults', () => {
    const config = economyConfig.parse({});
    expect(config.currency.name).toBe('Joules');
    expect(config.dailyCap).toBe(500);
    expect(config.shop).toEqual([]);
  });

  it('fills item defaults', () => {
    expect(items[0]).toMatchObject({
      stock: null,
      perUser: null,
      enabled: true,
      durationHours: null,
    });
  });
});

describe('shop lookup', () => {
  it('finds visible items by number, id, name and prefix', () => {
    expect(findItem(items, '1')?.id).toBe('vip');
    expect(findItem(items, '2')?.id).toBe('starter');
    expect(findItem(items, 'sunset')?.id).toBe('sunset');
    expect(findItem(items, 'Starter')?.id).toBe('starter');
    expect(findItem(items, 'hidden')).toBeNull();
    expect(findItem(items, '')).toBeNull();
  });

  it('maps items to purchases', () => {
    const [role, , pack, background] = items;
    if (!role || !pack || !background) throw new Error('fixture');
    expect(purchaseInput(role)).toMatchObject({ ref: '123456789012345678', inventory: false });
    expect(purchaseInput(pack)).toMatchObject({ ref: 'standard', inventory: true, unique: false });
    expect(purchaseInput(background)).toMatchObject({ ref: 'bg-sunset', unique: true });
  });
});

describe('wallet math', () => {
  it('grows the daily with the streak up to the cap', () => {
    const rules = { amount: 100, streakBonus: 10, streakCap: 3 };
    expect([1, 2, 3, 9].map((streak) => dailyAmount(rules, streak))).toEqual([100, 110, 120, 120]);
  });

  it('keeps a streak only within two days', () => {
    const last = new Date(Date.UTC(2026, 9, 1));
    expect(nextStreak(null, 0, last)).toBe(1);
    expect(nextStreak(last, 4, new Date(last.getTime() + DAY_MS + 1))).toBe(5);
    expect(nextStreak(last, 4, new Date(last.getTime() + 3 * DAY_MS))).toBe(1);
  });

  it('splits tax and rounds down', () => {
    expect(splitTax(99, 5)).toEqual({ tax: 4, received: 95 });
    expect(splitTax(10, 0)).toEqual({ tax: 0, received: 10 });
  });

  it('respects the daily cap', () => {
    expect(cappedAmount(40, 480, 500)).toBe(20);
    expect(cappedAmount(40, 500, 500)).toBe(0);
    expect(cappedAmount(40, 9_999, null)).toBe(40);
  });
});

describe('earnings', () => {
  it('rolls inside the range even when min and max are swapped', () => {
    expect(rollAmount(1, 5, () => 0)).toBe(1);
    expect(rollAmount(1, 5, () => 0.999)).toBe(5);
    expect(rollAmount(5, 1, () => 0)).toBe(1);
  });

  it('throttles per key and stays bounded', () => {
    let now = 0;
    const throttle = new Throttle(2, () => now);
    expect(throttle.take('a', 1000)).toBe(true);
    expect(throttle.take('a', 1000)).toBe(false);
    now = 1000;
    expect(throttle.take('a', 1000)).toBe(true);
    throttle.take('b', 1000);
    throttle.take('c', 1000);
    expect(throttle.size).toBe(2);
  });

  it('formats money with the configured names', () => {
    const currency = economyConfig.parse({}).currency;
    expect(money(1, currency)).toBe('**1** Joule');
    expect(money(1250, currency)).toBe('**1,250** Joules');
    expect(short(1250, currency)).toBe('1,250 J');
  });
});
