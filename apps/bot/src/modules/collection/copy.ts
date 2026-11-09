import { mention } from '../../commands/mentions.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/collection.json' with { type: 'json' };
import { andList, code, timestamp } from '../../ui/format.js';

export const copy = catalog('collection', en, (m) => ({
  summary: {
    self: (total: number, unique: number) => m.summary.self({ total, unique }),
    other: (userId: string, total: number, unique: number) =>
      m.summary.other({ user: mention.user(userId), total, unique }),
    emptyOther: (userId: string) => m.summary.emptyOther({ user: mention.user(userId) }),
    hint: (prefix: string) => m.summary.hint({ prefix }),
  },
  view: {
    header: (userId: string, total: number, unique: number) =>
      m.view.header({ user: mention.user(userId), total, unique }),
    unknown: (query: string) => m.view.unknown({ query: code(query) }),
  },
  pack: {
    unknown: (query: string, prefix: string) => m.pack.unknown({ query: code(query), prefix }),
    pick: (names: string) => m.pack.pick({ names }),
    funds: (price: string, balance: string) => m.pack.funds({ price, balance }),
    opened: (name: string, size: number) => m.pack.opened({ name, size }),
  },
  claim: {
    got: (name: string, rarity: string) => m.claim.got({ name, rarity }),
  },
  drop: {
    hint: (command: string, until: Date) =>
      m.drop.hint({ command: code(command), until: timestamp(until, 'R') }),
    wished: (users: string[]) =>
      m.drop.wished({ users: users.map((id) => mention.user(id)).join(' ') }),
    claimed: (userId: string) => m.drop.claimed({ user: mention.user(userId) }),
  },
  trade: {
    usage: (prefix: string) => m.trade.usage({ prefix }),
    tooMany: (max: number) => m.trade.tooMany({ max }),
    missing: (number: string) => m.trade.missing({ number }),
    theyLack: (userId: string, number: string) =>
      m.trade.theyLack({ user: mention.user(userId), number }),
    offer: (from: string, to: string, give: string, want: string) =>
      m.trade.offer({
        mode: give && want ? 'both' : give ? 'give' : 'want',
        from: mention.user(from),
        to: mention.user(to),
        give,
        want,
      }),
    confirm: (yes: string, no: string, until: Date) =>
      m.trade.confirm({ yes, no, until: timestamp(until, 't') }),
    cancelled: (userId: string) => m.trade.cancelled({ user: mention.user(userId) }),
  },
  wishlist: {
    added: (name: string) => m.wishlist.added({ name }),
    exists: (name: string) => m.wishlist.exists({ name }),
    full: (max: number) => m.wishlist.full({ max }),
    removed: (name: string) => m.wishlist.removed({ name }),
    notOn: (name: string) => m.wishlist.notOn({ name }),
    usage: (prefix: string) => m.wishlist.usage({ prefix }),
  },
  sets: {
    reward: (parts: string[]) => m.sets.reward({ parts: andList(parts) }),
    completed: (name: string, rewards: string[]) =>
      m.sets.completed({
        hasRewards: rewards.length > 0 ? 'yes' : 'no',
        name,
        rewards: andList(rewards),
      }),
    completedBy: (userId: string, name: string, rewards: string[]) =>
      m.sets.completedBy({
        hasRewards: rewards.length > 0 ? 'yes' : 'no',
        user: mention.user(userId),
        name,
        rewards: andList(rewards),
      }),
    progress: (owned: number, total: number) => m.sets.progress({ owned, total }),
    roleReason: (name: string) => m.sets.roleReason({ name }),
  },
}));

export const auditText = {
  granted: (name: string, userId: string, n: number) =>
    n > 1 ? `Gave ${n} copies of ${name} to ${userId}` : `Gave ${name} to ${userId}`,
  revoked: (name: string, userId: string, n: number) =>
    n > 1 ? `Took ${n} copies of ${name} from ${userId}` : `Took ${name} from ${userId}`,
  dropped: (name: string) => `Dropped ${name}`,
  someCard: 'a card',
};
