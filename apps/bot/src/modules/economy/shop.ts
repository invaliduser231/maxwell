import type { JobInput } from '@maxwell/core';
import type { ShopItem } from '@maxwell/core/modules/economy';
import type { PurchaseInput } from '@maxwell/core/stores/economy';
import type { Services } from '../../services.js';
import { copy } from './copy.js';
import type { Wallets } from './wallets.js';

const HOUR = 3_600_000;

export type Schedule = (kind: string, input: Omit<JobInput, 'kind'>) => Promise<string | null>;

export interface BuyResult {
  ok: boolean;
  text: string;
}

export function visibleItems(items: readonly ShopItem[]): ShopItem[] {
  return items.filter((item) => item.enabled);
}

export function findItem(items: readonly ShopItem[], query: string): ShopItem | null {
  const visible = visibleItems(items);
  const wanted = query.trim().toLowerCase();
  if (!wanted) return null;
  if (/^\d+$/.test(wanted)) {
    const byIndex = visible[Number(wanted) - 1];
    if (byIndex) return byIndex;
  }
  return (
    visible.find((item) => item.id === wanted) ??
    visible.find((item) => item.name.toLowerCase() === wanted) ??
    visible.find((item) => item.name.toLowerCase().startsWith(wanted)) ??
    null
  );
}

export function itemRef(item: ShopItem): string | null {
  switch (item.kind) {
    case 'role':
      return item.roleId;
    case 'pack':
      return item.packId;
    case 'background':
      return item.assetKey;
    case 'giveaway':
      return item.giveawayId;
  }
}

export function purchaseInput(item: ShopItem): PurchaseInput {
  return {
    itemId: item.id,
    kind: item.kind,
    price: item.price,
    stock: item.stock,
    perUser: item.perUser,
    ref: itemRef(item),
    inventory: item.kind !== 'role',
    unique: item.kind === 'background',
  };
}

export class Shop {
  constructor(
    private readonly services: Services,
    private readonly wallets: Wallets,
    private readonly schedule: Schedule,
  ) {}

  async buy(guildId: string, userId: string, item: ShopItem, prefix: string): Promise<BuyResult> {
    const { platform, voice, log } = this.services;
    const config = await this.wallets.config(guildId);
    const currency = config.currency;
    const store = this.wallets.store;
    await this.wallets.ensure(guildId, userId, config);

    if (item.kind === 'role') {
      const roles = await platform.roles(guildId).catch(() => []);
      if (!roles.some((role) => role.id === item.roleId)) {
        log.warn({ guild: guildId, item: item.id }, 'shop role missing');
        return { ok: false, text: copy.buy.roleGone };
      }
      const member = await platform.member(guildId, userId);
      if (member?.roles.includes(item.roleId)) {
        return { ok: false, text: copy.buy.roleHeld(item.roleId) };
      }
      const missing = await platform.missingBotPermissions(guildId, null, ['ManageRoles']);
      if (missing.length) {
        return { ok: false, text: voice.botMissingPermissions(missing, copy.buy.where) };
      }
    }

    if (
      item.kind === 'background' &&
      (await store.owns(guildId, userId, 'background', item.assetKey))
    ) {
      await store.setBackground(guildId, userId, item.assetKey);
      return { ok: true, text: copy.buy.equipped(item.name) };
    }

    const result = await store.purchase(guildId, userId, purchaseInput(item));
    if (!result.ok) {
      switch (result.reason) {
        case 'sold_out':
          return { ok: false, text: copy.buy.soldOut(item.name) };
        case 'limit':
          return { ok: false, text: copy.buy.limit(item.name) };
        case 'owned':
          return { ok: true, text: copy.buy.equipped(item.name) };
        case 'funds':
          return {
            ok: false,
            text: copy.buy.funds(item.price, await store.balance(guildId, userId), currency),
          };
      }
    }

    switch (item.kind) {
      case 'role': {
        try {
          await platform.addRole(guildId, userId, item.roleId, copy.reasons.bought(item.name));
        } catch (error) {
          log.warn({ err: error, guild: guildId, item: item.id }, 'shop role grant failed');
          await store.refund(guildId, result.purchaseId, false);
          return { ok: false, text: copy.buy.roleFailed(item.roleId) };
        }
        const until = item.durationHours ? new Date(Date.now() + item.durationHours * HOUR) : null;
        if (until) {
          await this.schedule('roleExpire', {
            guildId,
            runAt: until,
            payload: { userId, roleId: item.roleId, purchaseId: result.purchaseId },
            dedupeKey: `economy.roleExpire:${guildId}:${result.purchaseId}`,
          });
        }
        return { ok: true, text: copy.buy.role(item.roleId, until) };
      }
      case 'background':
        await store.setBackground(guildId, userId, item.assetKey);
        return { ok: true, text: copy.buy.background(item.name) };
      case 'pack':
        return { ok: true, text: copy.buy.pack(item.name, `${prefix}cards pack ${item.packId}`) };
      case 'giveaway':
        return { ok: true, text: copy.buy.giveaway(item.name) };
    }
  }
}
