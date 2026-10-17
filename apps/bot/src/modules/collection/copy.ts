import { mention } from '../../commands/mentions.js';
import { localized } from '../../i18n/localized.js';
import { andList, code, count, plural, timestamp } from '../../ui/format.js';
import de from './copy.de.js';

const en = {
  commands: {
    cards: 'Collect cards of your community and custom decks.',
    view: "Your collection, someone else's, or one card up close.",
    pack: 'Open a card pack. Uses one from the shop first, otherwise pays the price.',
    trade: 'Offer cards to a member for some of theirs. Both have to agree.',
    wishlist: 'Cards you want. You get pinged when one drops.',
    sets: 'The sets here and how far along you are.',
    optin: 'Put your own card into the community deck.',
    optout: 'Take your card out of the community deck. Every copy disappears.',
    claim: 'Grab the card that just dropped here.',
  },
  communityDeck: 'Community',
  unknownMember: "That's not a member I can find.",
  summary: {
    self: (total: number, unique: number) =>
      `You have **${plural(total, 'card')}**, ${count(unique)} different.`,
    other: (userId: string, total: number, unique: number) =>
      `${mention.user(userId)} has **${plural(total, 'card')}**, ${count(unique)} different.`,
    emptySelf: [
      'No cards yet. Wait for a drop or open a pack.',
      'Your collection is empty so far.',
    ],
    emptyOther: (userId: string) => `${mention.user(userId)} has no cards yet.`,
    hint: (prefix: string) => `${prefix}cards view for the full list`,
  },
  view: {
    title: 'Collection',
    header: (userId: string, total: number, unique: number) =>
      `${mention.user(userId)}: ${plural(total, 'card')}, ${count(unique)} different`,
    unknown: (query: string) => `No card called ${code(query)} here.`,
    rarity: 'Rarity',
    deck: 'Deck',
    owners: 'Owners',
    yours: 'You own',
    wished: 'Wished by',
    retired: 'No longer drops.',
  },
  pack: {
    none: 'No packs here yet. An admin can add some in the dashboard.',
    unknown: (query: string, prefix: string) =>
      `No pack called ${code(query)}. ${code(`${prefix}shop`)} or the dashboard shows what exists.`,
    pick: (names: string) => `Which one? ${names}`,
    economyOff: 'Packs cost money, and Economy is off here.',
    funds: (price: string, balance: string) => `That pack costs ${price}. You have ${balance}.`,
    empty: 'There are no cards to draw yet.',
    opened: (name: string, size: number) => `**${name}**, ${plural(size, 'card')}:`,
    fromInventory: 'Paid for in the shop',
    isNew: 'new',
  },
  claim: {
    nothing: 'Nothing to claim here.',
    got: (name: string, rarity: string) => `**${name}** (${rarity}) is yours.`,
  },
  drop: {
    title: 'A card dropped',
    hint: (command: string, until: Date) =>
      `First to type ${code(command)} gets it. Gone ${timestamp(until, 'R')}.`,
    wished: (users: string[]) => `Wished by ${users.map((id) => mention.user(id)).join(' ')}`,
    claimed: (userId: string) => `Claimed by ${mention.user(userId)}.`,
    expired: 'Nobody claimed it.',
    noPool: 'There are no cards to drop yet.',
    noChannel: 'No drop channel set.',
  },
  trade: {
    off: 'Trading is off here.',
    self: "You can't trade with yourself.",
    bot: "Bots don't collect cards.",
    usage: (prefix: string) => `${prefix}cards trade <member> <your cards> for <their cards>`,
    empty: 'Name at least one card, like #12.',
    tooMany: (max: number) => `Up to ${plural(max, 'card')} per side.`,
    missing: (number: string) => `You don't have #${number}.`,
    theyLack: (userId: string, number: string) =>
      `${mention.user(userId)} doesn't have #${number}.`,
    busy: 'One of you already has an open trade. Finish that first.',
    offer: (from: string, to: string, give: string, want: string) =>
      give && want
        ? `${mention.user(from)} offers ${give} for ${want} from ${mention.user(to)}.`
        : give
          ? `${mention.user(from)} gives ${give} to ${mention.user(to)}.`
          : `${mention.user(from)} asks ${mention.user(to)} for ${want}.`,
    confirm: (yes: string, no: string, until: Date) =>
      `Both react with ${yes} to trade or ${no} to cancel. Open until ${timestamp(until, 't')}.`,
    done: 'Traded.',
    cancelled: (userId: string) => `Cancelled by ${mention.user(userId)}. Nothing changed hands.`,
    expired: 'No answer, so nothing happened.',
    failed: 'Someone no longer has those cards, so nothing changed hands.',
    nothing: 'nothing',
  },
  wishlist: {
    title: 'Wishlist',
    empty: ['Your wishlist is empty.', 'Nothing on your wishlist yet.'],
    which: 'Which card?',
    added: (name: string) => `**${name}** is on your wishlist. I'll ping you when it drops.`,
    exists: (name: string) => `**${name}** is already on your wishlist.`,
    full: (max: number) => `Your wishlist is full at ${count(max)}. Remove one first.`,
    removed: (name: string) => `**${name}** is off your wishlist.`,
    notOn: (name: string) => `**${name}** wasn't on your wishlist.`,
    usage: (prefix: string) => `${prefix}cards wishlist [add|remove] <card>`,
  },
  sets: {
    title: 'Sets',
    empty: ['No sets here yet.', 'There are no sets to finish yet.'],
    reward: (parts: string[]) => `Reward: ${andList(parts)}`,
    completed: (name: string, rewards: string[]) =>
      rewards.length > 0
        ? `Set complete: **${name}**. ${andList(rewards)}.`
        : `Set complete: **${name}**.`,
    completedBy: (userId: string, name: string, rewards: string[]) =>
      rewards.length > 0
        ? `${mention.user(userId)} finished the set **${name}**. ${andList(rewards)}.`
        : `${mention.user(userId)} finished the set **${name}**.`,
    progress: (owned: number, total: number) => `${count(owned)} / ${count(total)}`,
    roleReason: (name: string) => `Completed the set ${name}`,
  },
  optin: {
    off: 'The community deck is off here.',
    done: 'You are in the community deck now. Others can collect your card.',
    already: 'You are already in the community deck.',
  },
  optout: {
    done: 'You are out of the community deck. Every copy of your card is gone.',
    notIn: "You weren't in the community deck.",
  },
};

export type CollectionCopy = typeof en;

export const copy = localized(en, { de });

export const auditText = {
  granted: (name: string, userId: string, n: number) =>
    n > 1 ? `Gave ${n} copies of ${name} to ${userId}` : `Gave ${name} to ${userId}`,
  revoked: (name: string, userId: string, n: number) =>
    n > 1 ? `Took ${n} copies of ${name} from ${userId}` : `Took ${name} from ${userId}`,
  dropped: (name: string) => `Dropped ${name}`,
  someCard: 'a card',
};
