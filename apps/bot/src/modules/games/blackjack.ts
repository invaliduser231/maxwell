import type { BlackjackHand, BlackjackSession } from '@maxwell/core/stores/games';
import type { GuildContext } from '../../commands/types.js';
import type { Embed, IncomingMessage, ReactionEvent } from '../../platform/types.js';
import { lines, subtext } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import type { Schedule } from '../economy/shop.js';
import { type Currency, money } from '../economy/wallets.js';
import {
  type Action,
  canDouble,
  canSplit,
  dealerShouldPeek,
  draw,
  face,
  natural,
  type Outcome,
  outcome,
  parseAction,
  payout,
  playDealer,
  type Random,
  shoe,
  total,
} from './blackjack-rules.js';
import { copy } from './copy.js';
import { pressed, Seats } from './seats.js';
import type { Games } from './service.js';

const ACTIVE_LIMIT = 10_000;
const REVEAL_DELAY = 700;
const REF = 'blackjack';

const keys: Record<Action, string> = {
  hit: String.fromCodePoint(0x2795),
  stand: String.fromCodePoint(0x270b),
  double: String.fromCodePoint(0x32, 0xfe0f, 0x20e3),
  split: String.fromCodePoint(0x2702, 0xfe0f),
};

interface Options {
  random?: Random;
  delay?: (ms: number) => Promise<void>;
  deck?: (decks: number) => string[];
}

interface Settled {
  results: Outcome[];
  staked: number;
  net: number;
  reward: string | null;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Blackjack {
  readonly #active = new Map<string, string>();
  readonly #seats: Seats;
  readonly #random: Random;
  readonly #delay: (ms: number) => Promise<void>;
  readonly #deck: (decks: number) => string[];

  constructor(
    private readonly games: Games,
    private readonly schedule: Schedule,
    options: Options = {},
  ) {
    this.#seats = new Seats(() => games.services.platform);
    this.#random = options.random ?? Math.random;
    this.#delay = options.delay ?? wait;
    this.#deck = options.deck ?? ((decks) => shoe(decks, this.#random));
  }

  async load(): Promise<void> {
    for (const session of await this.games.store.activeBlackjack()) {
      this.#track(session.guildId, session.userId, session.channelId);
      if (session.messageId) {
        this.#seats.sit(session.messageId, {
          guildId: session.guildId,
          userId: session.userId,
          tidy: false,
        });
      }
    }
  }

  #track(guildId: string, userId: string, channelId: string): void {
    if (this.#active.size >= ACTIVE_LIMIT) {
      const oldest = this.#active.keys().next().value;
      if (oldest !== undefined) this.#active.delete(oldest);
    }
    this.#active.set(`${guildId}:${userId}`, channelId);
  }

  async #expireAt(guildId: string, userId: string, at: Date): Promise<void> {
    await this.schedule('blackjackExpire', {
      guildId,
      runAt: at,
      payload: { userId },
      dedupeKey: `games.blackjack:${guildId}:${userId}:${at.getTime()}`,
    });
  }

  async start(ctx: GuildContext, stake: number | undefined): Promise<void> {
    const config = await this.games.config(ctx.guildId);
    const rules = config.blackjack;
    if (!(await this.games.allowed(ctx, rules.enabled, copy.names.blackjack))) return;
    const userId = ctx.message.author.id;
    const { store, wallets } = this.games;

    const existing = await store.blackjack(ctx.guildId, userId);
    if (existing) {
      if (existing.expiresAt.getTime() > Date.now()) {
        await ctx.reply({
          content: copy.blackjack.running(existing.channelId),
          deleteAfter: 15_000,
        });
        return;
      }
      await this.expire(ctx.guildId, userId);
    }

    let currency: Currency | null = null;
    if (stake) {
      const check = await this.games.checkStake(ctx, stake, [userId]);
      if (!check.ok) return;
      currency = check.currency;
      if (!(await wallets.store.debit(ctx.guildId, userId, stake, 'stake', { ref: REF }))) {
        const balance = await wallets.store.balance(ctx.guildId, userId);
        await ctx.reply({ content: copy.broke(money(balance, currency)), deleteAfter: 15_000 });
        return;
      }
    }

    const deck = this.#deck(rules.decks);
    const pull = () => draw(deck, rules.decks, this.#random);
    const first = pull();
    const up = pull();
    const second = pull();
    const dealer = [up, pull()];
    const hand: BlackjackHand = {
      cards: [first, second],
      stake: stake ?? 0,
      doubled: false,
      done: false,
      split: false,
    };
    const until = new Date(Date.now() + rules.timeoutSeconds * 1000);
    const session: BlackjackSession = {
      guildId: ctx.guildId,
      userId,
      channelId: ctx.message.channelId,
      messageId: null,
      shoe: deck,
      dealer,
      hands: [hand],
      active: 0,
      version: 0,
      expiresAt: until,
    };

    const houseNatural = dealerShouldPeek(dealer) && natural({ cards: dealer, split: false });
    if (natural(hand) || houseNatural) {
      hand.done = true;
      const settled = await this.#settle(session, rules.decks);
      await ctx.reply({ embeds: [this.#render(session, currency, settled, false)] });
      return;
    }

    if (!(await store.startBlackjack(session))) {
      if (stake) await wallets.store.credit(ctx.guildId, userId, stake, 'refund', { ref: REF });
      await ctx.reply({
        content: copy.blackjack.running(ctx.message.channelId),
        deleteAfter: 15_000,
      });
      return;
    }
    this.#track(ctx.guildId, userId, ctx.message.channelId);
    await this.#expireAt(ctx.guildId, userId, until);
    const messageId = await ctx.reply({ embeds: [this.#render(session, currency, null, true)] });
    await store.setBlackjackMessage(ctx.guildId, userId, messageId);
    const offered = [keys.hit, keys.stand, keys.double];
    if (canSplit(session.hands, hand)) offered.push(keys.split);
    await this.#seats.open(ctx.guildId, ctx.message.channelId, messageId, userId, offered);
  }

  async onMessage(message: IncomingMessage): Promise<void> {
    const guildId = message.guildId;
    if (!guildId || message.author.bot) return;
    if (this.#active.get(`${guildId}:${message.author.id}`) !== message.channelId) return;
    const action = parseAction(message.content);
    if (action) await this.#act(guildId, message.author.id, action);
  }

  async onReaction(reaction: ReactionEvent, added: boolean): Promise<void> {
    const action = pressed(reaction.emoji, keys);
    if (!action) return;
    const seat = await this.#seats.press(reaction, added);
    if (seat) await this.#act(seat.guildId, seat.userId, action);
  }

  async #act(guildId: string, userId: string, action: Action): Promise<void> {
    const { store, wallets } = this.games;
    const session = await store.blackjack(guildId, userId);
    if (!session) {
      this.#active.delete(`${guildId}:${userId}`);
      return;
    }
    const rules = (await this.games.config(guildId)).blackjack;
    const hand = session.hands[session.active];
    if (!hand || hand.done) return;
    const pull = () => draw(session.shoe, rules.decks, this.#random);
    let paid = 0;
    let note: string | null = null;

    const pay = async (amount: number): Promise<boolean> => {
      if (amount <= 0) return true;
      if (!(await wallets.store.debit(guildId, userId, amount, 'stake', { ref: REF }))) {
        note = copy.blackjack.noFunds;
        return false;
      }
      paid += amount;
      return true;
    };

    switch (action) {
      case 'hit':
        hand.cards.push(pull());
        if (total(hand.cards).value >= 21) hand.done = true;
        break;
      case 'stand':
        hand.done = true;
        break;
      case 'double':
        if (!canDouble(hand) || !(await pay(hand.stake))) break;
        hand.stake *= 2;
        hand.doubled = true;
        hand.cards.push(pull());
        hand.done = true;
        break;
      case 'split': {
        if (!canSplit(session.hands, hand) || !(await pay(hand.stake))) break;
        const [a, b] = hand.cards as [string, string];
        const aces = a[0] === 'A';
        session.hands = [a, b].map((card) => {
          const cards = [card, pull()];
          return {
            cards,
            stake: hand.stake,
            doubled: false,
            split: true,
            done: aces || total(cards).value === 21,
          };
        });
        break;
      }
    }

    while (session.active < session.hands.length && session.hands[session.active]?.done) {
      session.active += 1;
    }
    if (session.active >= session.hands.length) {
      const finished = await this.#finish(session, false);
      if (!finished && paid > 0) {
        await wallets.store.credit(guildId, userId, paid, 'refund', { ref: REF });
      }
      return;
    }

    session.expiresAt = new Date(Date.now() + rules.timeoutSeconds * 1000);
    if (!(await store.saveBlackjack(session))) {
      if (paid > 0) await wallets.store.credit(guildId, userId, paid, 'refund', { ref: REF });
      return;
    }
    await this.#expireAt(guildId, userId, session.expiresAt);
    const currency = session.hands.some((entry) => entry.stake > 0)
      ? await this.games.currency(guildId)
      : null;
    await this.#show(session, this.#render(session, currency, null, true, note));
  }

  async expire(guildId: string, userId: string): Promise<void> {
    const session = await this.games.store.blackjack(guildId, userId);
    if (!session || session.expiresAt.getTime() > Date.now() + 1_000) return;
    for (const hand of session.hands) hand.done = true;
    await this.#finish(session, true);
  }

  async #finish(session: BlackjackSession, timedOut: boolean): Promise<boolean> {
    const { guildId, userId } = session;
    const ended = await this.games.store.endBlackjack(guildId, userId, session.version);
    if (!ended) return false;
    this.#active.delete(`${guildId}:${userId}`);
    const rules = (await this.games.config(guildId)).blackjack;
    const settled = await this.#settle(session, rules.decks);
    const currency = settled.staked > 0 ? await this.games.currency(guildId) : null;

    if (session.messageId) {
      for (let count = 2; count <= session.dealer.length; count++) {
        const frame = { ...session, dealer: session.dealer.slice(0, count) };
        await this.#show(frame, this.#render(frame, currency, null, false));
        await this.#delay(REVEAL_DELAY);
      }
      await this.#show(session, this.#render(session, currency, settled, false, null, timedOut));
      await this.#seats.close(session.channelId, session.messageId, Object.values(keys));
      return true;
    }
    await this.games.services.platform
      .send(session.channelId, {
        embeds: [this.#render(session, currency, settled, false, null, timedOut)],
      })
      .catch(() => {});
    return true;
  }

  async #settle(session: BlackjackSession, decks: number): Promise<Settled> {
    const { guildId, userId, hands } = session;
    if (hands.some((hand) => total(hand.cards).value <= 21 && !natural(hand))) {
      playDealer(session.dealer, session.shoe, decks, this.#random);
    }
    const results = hands.map((hand) => outcome(hand, session.dealer));
    const staked = hands.reduce((sum, hand) => sum + hand.stake, 0);
    const returned = hands.reduce((sum, hand, i) => sum + payout(hand, results[i] as Outcome), 0);
    const net = returned - staked;
    const wallet = this.games.wallets.store;
    if (returned > 0) await wallet.credit(guildId, userId, returned, 'game', { ref: REF });
    const won = results.some((result) => result === 'win' || result === 'blackjack');
    await this.games.store.score(guildId, 'blackjack', userId, {
      win: staked > 0 ? net > 0 : won,
      net,
    });
    const reward =
      staked === 0 && won ? await this.games.reward(guildId, userId, 'blackjack') : null;
    return { results, staked, net, reward };
  }

  async #show(session: Pick<BlackjackSession, 'channelId' | 'messageId'>, embed: Embed) {
    if (!session.messageId) return;
    await this.games.services.platform
      .edit(session.channelId, session.messageId, { embeds: [embed] })
      .catch(() => {});
  }

  #render(
    session: Pick<BlackjackSession, 'dealer' | 'hands' | 'active' | 'expiresAt'>,
    currency: Currency | null,
    settled: Settled | null,
    playing: boolean,
    note: string | null = null,
    timedOut = false,
  ): Embed {
    const cards = (list: readonly string[]) => list.map((card) => `\`${face(card)}\``).join(' ');
    const dealer = playing
      ? `**${copy.blackjack.dealer}**  ${cards(session.dealer.slice(0, 1))} \`?\``
      : `**${copy.blackjack.dealer}**  ${cards(session.dealer)}  **${total(session.dealer).value}**`;
    const many = session.hands.length > 1;
    const hands = session.hands.map((hand, i) => {
      const label = many ? copy.blackjack.hand(i + 1) : copy.blackjack.you;
      const current = playing && many && i === session.active;
      const tags = [
        hand.doubled && copy.blackjack.doubled,
        hand.stake > 0 && currency && money(hand.stake, currency),
        settled && copy.blackjack.outcome[settled.results[i] as Outcome],
      ].filter(Boolean);
      const name = current ? `**${label}** ${copy.blackjack.turn}` : `**${label}**`;
      return `${name}  ${cards(hand.cards)}  **${total(hand.cards).value}**${tags.length ? `  ${tags.join(', ')}` : ''}`;
    });

    let summary: string | null = null;
    if (settled) {
      if (settled.staked > 0 && currency) {
        summary =
          settled.net > 0
            ? copy.blackjack.won(money(settled.net, currency))
            : settled.net < 0
              ? copy.blackjack.lost(money(-settled.net, currency))
              : copy.blackjack.even;
      } else {
        const won = settled.results.some((r) => r === 'win' || r === 'blackjack');
        const pushed = settled.results.every((r) => r === 'push');
        summary = won
          ? copy.blackjack.freeWon
          : pushed
            ? copy.blackjack.freePush
            : copy.blackjack.freeLost;
      }
      if (settled.reward) summary = `${summary} ${settled.reward}.`;
    }

    const hand = session.hands[session.active];
    const options: Action[] = ['hit', 'stand'];
    if (hand && canDouble(hand)) options.push('double');
    if (hand && canSplit(session.hands, hand)) options.push('split');
    const color = !settled
      ? palette.north
      : settled.net > 0 ||
          (settled.staked === 0 && settled.results.some((r) => r === 'win' || r === 'blackjack'))
        ? palette.success
        : settled.net < 0 || settled.results.every((r) => r === 'lose' || r === 'bust')
          ? palette.danger
          : palette.muted;

    return {
      color,
      title: copy.names.blackjack,
      description: lines(
        dealer,
        '',
        ...hands,
        note && '',
        note,
        summary && '',
        timedOut && copy.blackjack.timeout,
        summary && `**${summary}**`,
        playing && '',
        playing &&
          subtext(
            copy.blackjack.how(
              options.map((option) => copy.blackjack.keys[option](keys[option])),
              session.expiresAt,
            ),
          ),
      ),
    };
  }
}
