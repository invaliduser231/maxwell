import { mention } from '../../commands/mentions.js';
import { catalog } from '../../i18n/catalog.js';
import en from '../../locales/en/games.json' with { type: 'json' };
import { timestamp } from '../../ui/format.js';

export const copy = catalog('games', en, (m) => ({
  off: (game: string) => m.off({ game }),
  stakeRange: (min: string, max: string) => m.stakeRange({ min, max }),
  broke: (balance: string) => m.broke({ balance }),
  reward: (amount: string) => m.reward({ amount }),
  trivia: {
    prompt: (until: Date) => m.trivia.prompt({ until: timestamp(until, 'R') }),
    won: (userId: string, answer: string) => m.trivia.won({ user: mention.user(userId), answer }),
    timeout: (answer: string) => m.trivia.timeout({ answer }),
  },
  counting: {
    broke: (userId: string, reached: number, reset: boolean) =>
      m.counting.broke({ reset: reset ? 'yes' : 'no', user: mention.user(userId), reached }),
    twice: (userId: string, reset: boolean) =>
      m.counting.twice({ reset: reset ? 'yes' : 'no', user: mention.user(userId) }),
    expected: (n: number) => m.counting.expected({ n }),
    milestone: (n: number, userId: string, amount: string) =>
      m.counting.milestone({ n, user: mention.user(userId), amount }),
  },
  wordchain: {
    letter: (word: string, letter: string) => m.wordchain.letter({ word, letter }),
    repeat: (word: string) => m.wordchain.repeat({ word }),
    reset: (reached: number) => m.wordchain.reset({ ended: reached > 0 ? 'yes' : 'no', reached }),
  },
  hilo: {
    running: (channelId: string) => m.hilo.running({ channel: mention.channel(channelId) }),
    start: (n: number, max: number, stake: string | null) =>
      m.hilo.start({ staked: stake ? 'yes' : 'no', n, max, stake: stake ?? '' }),
    how: (until: Date, keys: { up: string; down: string; stop: string }) =>
      m.hilo.how({ ...keys, until: timestamp(until, 'R') }),
    right: (n: number, streak: number, worth: string | null) =>
      m.hilo.right({ valued: worth ? 'yes' : 'no', n, streak, worth: worth ?? '' }),
    wrong: (n: number, streak: number, lost: string | null) =>
      m.hilo.wrong({ staked: lost ? 'yes' : 'no', n, streak, lost: lost ?? '' }),
    cashed: (amount: string, streak: number) => m.hilo.cashed({ amount, streak }),
    refunded: (amount: string) => m.hilo.refunded({ amount }),
    stopped: (streak: number) => m.hilo.stopped({ streak }),
    timeout: (userId: string, text: string) => m.hilo.timeout({ user: mention.user(userId), text }),
  },
  coinflip: {
    challenge: (from: string, to: string, stake: string | null) =>
      m.coinflip.challenge({
        staked: stake ? 'yes' : 'no',
        to: mention.user(to),
        from: mention.user(from),
        stake: stake ?? '',
      }),
    confirm: (yes: string, no: string, until: Date) =>
      m.coinflip.confirm({ yes, no, until: timestamp(until, 't') }),
    won: (side: string, winner: string, pot: string | null) =>
      m.coinflip.won({
        staked: pot ? 'yes' : 'no',
        side,
        winner: mention.user(winner),
        pot: pot ?? '',
      }),
    declined: (userId: string) => m.coinflip.declined({ user: mention.user(userId) }),
  },
  board: {
    title: (game: string) => m.board.title({ game }),
    wins: (n: number) => m.board.wins({ n }),
    best: (n: number) => m.board.best({ n }),
    you: (rank: number, value: string) => m.board.you({ rank, value }),
  },
}));

export const gameNames = en.names;

export const auditText = {
  reset: (game: string) => `Reset the ${game} channel`,
};
