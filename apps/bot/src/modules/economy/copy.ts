import { mention } from '../../commands/mentions.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/economy.json' with { type: 'json' };
import { code, timestamp } from '../../ui/format.js';
import { type Currency, money } from './wallets.js';

export const copy = catalog('economy', en, (m) => ({
  coins: {
    added: (amount: string, userId: string, balance: string) =>
      m.coins.added({ amount, user: mention.user(userId), balance }),
    removed: (amount: string, userId: string, balance: string) =>
      m.coins.removed({ amount, user: mention.user(userId), balance }),
    nothing: (userId: string) => m.coins.nothing({ user: mention.user(userId) }),
  },
  balance: {
    self: (amount: number, c: Currency) => m.balance.self({ amount: money(amount, c) }),
    other: (userId: string, amount: number, c: Currency) =>
      m.balance.other({ user: mention.user(userId), amount: money(amount, c) }),
    rank: (rank: number) => m.balance.rank({ rank }),
    today: (earned: number, cap: number) => m.balance.today({ earned, cap }),
  },
  daily: {
    claimed: (amount: number, streak: number, c: Currency) =>
      m.daily.claimed({ amount: money(amount, c), streak: Math.max(streak, 0) }),
    next: (at: Date) => m.daily.next({ at: timestamp(at, 'R') }),
    wait: (command: string, at: Date) =>
      m.daily.wait({ command: code(command), at: timestamp(at, 'R') }),
  },
  pay: {
    broke: (amount: number, c: Currency) => m.pay.broke({ amount: money(amount, c) }),
    sent: (userId: string, received: number, tax: number, c: Currency) =>
      m.pay.sent({
        taxed: tax > 0 ? 'yes' : 'no',
        received: money(received, c),
        user: mention.user(userId),
        tax: money(tax, c),
      }),
  },
  shop: {
    left: (n: number) => m.shop.left({ n }),
    hint: (prefix: string) => m.shop.hint({ prefix }),
    confirm: (name: string, price: string, yes: string) => m.shop.confirm({ name, price, yes }),
    skipped: (name: string) => m.shop.skipped({ name }),
  },
  buy: {
    unknown: (query: string, prefix: string) => m.buy.unknown({ query: code(query), prefix }),
    soldOut: (name: string) => m.buy.soldOut({ name }),
    limit: (name: string) => m.buy.limit({ name }),
    funds: (price: number, balance: number, c: Currency) =>
      m.buy.funds({ price: money(price, c), balance: money(balance, c) }),
    roleHeld: (roleId: string) => m.buy.roleHeld({ role: mention.role(roleId) }),
    roleFailed: (roleId: string) => m.buy.roleFailed({ role: mention.role(roleId) }),
    role: (roleId: string, until: Date | null) =>
      m.buy.role({
        timed: until ? 'yes' : 'no',
        role: mention.role(roleId),
        until: until ? timestamp(until, 'f') : '',
      }),
    pack: (name: string, command: string) => m.buy.pack({ name, command: code(command) }),
    background: (name: string) => m.buy.background({ name }),
    equipped: (name: string) => m.buy.equipped({ name }),
    giveaway: (name: string) => m.buy.giveaway({ name }),
  },
  rich: {
    you: (rank: number, amount: string) => m.rich.you({ rank, amount }),
  },
  reasons: {
    bought: (name: string) => m.reasons.bought({ name }),
  },
}));

export const auditText = {
  gave: (amount: number, userId: string, c: Currency) => `Gave ${amount} ${c.name} to ${userId}`,
  took: (amount: number, userId: string, c: Currency) => `Took ${amount} ${c.name} from ${userId}`,
  rewarded: (members: number, amount: number, c: Currency) =>
    `Rewarded ${members} ${members === 1 ? 'member' : 'members'} with ${amount} ${c.name}`,
  refunded: (item: string, userId: string) => `Refunded ${item} to ${userId}`,
  restocked: (item: string) => `Restocked ${item}`,
  reset: (members: number, total: number, c: Currency) =>
    `Reset ${members} ${members === 1 ? 'wallet' : 'wallets'}, ${total} ${c.name} in total`,
};
