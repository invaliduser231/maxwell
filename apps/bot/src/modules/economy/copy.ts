import { mention } from '../../commands/mentions.js';
import { localized } from '../../i18n/localized.js';
import { code, count, ordinal, timestamp } from '../../ui/format.js';
import de from './copy.de.js';
import { type Currency, money } from './wallets.js';

const en = {
  commands: {
    balance: 'How much you or someone else has.',
    daily: 'Collect your daily reward. Come back every day for a streak.',
    pay: 'Send money to another member. Part of it goes to tax.',
    shop: 'What you can buy here.',
    buy: 'Buy something from the shop.',
    rich: 'Who has the most.',
  },
  balance: {
    self: (amount: number, c: Currency) => `You have ${money(amount, c)}.`,
    other: (userId: string, amount: number, c: Currency) =>
      `${mention.user(userId)} has ${money(amount, c)}.`,
    rank: (rank: number) => `#${count(rank)} here`,
    today: (earned: number, cap: number) => `${count(earned)} of ${count(cap)} earned today`,
    emptySelf: ['Nothing yet. Talk a bit, it adds up.', 'Empty so far.', 'Not a single one yet.'],
  },
  daily: {
    off: 'Daily rewards are off here.',
    claimed: (amount: number, streak: number, c: Currency) =>
      streak > 1
        ? `+${money(amount, c)}. ${ordinal(streak)} day in a row.`
        : `+${money(amount, c)}.`,
    next: (at: Date) => `Next one ${timestamp(at, 'R')}`,
    wait: (command: string, at: Date) => `${code(command)} is ready again ${timestamp(at, 'R')}.`,
    slow: ['Easy.', 'One at a time.'],
  },
  pay: {
    self: "You can't pay yourself.",
    bot: "Bots don't need money.",
    unknown: "That's not a member I can find.",
    tooSmall: 'Send at least 1.',
    broke: (amount: number, c: Currency) => `You only have ${money(amount, c)}.`,
    sent: (userId: string, received: number, tax: number, c: Currency) =>
      tax > 0
        ? `Sent ${money(received, c)} to ${mention.user(userId)}. ${money(tax, c)} went to tax.`
        : `Sent ${money(received, c)} to ${mention.user(userId)}.`,
  },
  shop: {
    title: 'Shop',
    empty: ['The shop is empty. An admin can stock it in the dashboard.', 'Nothing for sale yet.'],
    soldOut: 'sold out',
    left: (n: number) => `${count(n)} left`,
    hint: (prefix: string) => `${prefix}buy <item>`,
    kinds: {
      role: 'Role',
      pack: 'Card pack',
      background: 'Profile background',
      giveaway: 'Giveaway entry',
    } as Record<string, string>,
  },
  buy: {
    unknown: (query: string, prefix: string) =>
      `Nothing called ${code(query)} in the shop. ${code(`${prefix}shop`)} lists what's there.`,
    soldOut: (name: string) => `**${name}** is sold out.`,
    limit: (name: string) => `You already bought **${name}** as often as you can.`,
    funds: (price: number, balance: number, c: Currency) =>
      `That costs ${money(price, c)}. You have ${money(balance, c)}.`,
    roleGone: 'That role no longer exists. An admin has to fix this item in the dashboard.',
    roleHeld: (roleId: string) => `You already have ${mention.role(roleId)}.`,
    roleFailed: (roleId: string) =>
      `I couldn't give you ${mention.role(roleId)}, so the money is back in your wallet.`,
    role: (roleId: string, until: Date | null) =>
      until
        ? `${mention.role(roleId)} is yours until ${timestamp(until, 'f')}.`
        : `${mention.role(roleId)} is yours.`,
    pack: (name: string, command: string) => `**${name}** is yours. Open it with ${code(command)}.`,
    background: (name: string) => `**${name}** is on your profile now.`,
    equipped: (name: string) => `You already own **${name}**. It's on your profile again.`,
    giveaway: (name: string) => `**${name}** is yours. It counts in the next giveaway.`,
    where: 'in this community',
  },
  rich: {
    title: 'Richest',
    empty: ['Nobody has anything yet.', 'All wallets are empty. Very equal.'],
    you: (rank: number, amount: string) => `You: #${count(rank)} with ${amount}`,
    notYou: 'You are not on the board yet',
  },
  reasons: {
    bought: (name: string) => `Bought ${name} in the shop`,
    refunded: 'Shop purchase refunded',
    expired: 'Shop role expired',
  },
};

export type EconomyCopy = typeof en;

export const copy = localized(en, { de });

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
