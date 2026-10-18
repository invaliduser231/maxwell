import { mention } from '../../commands/mentions.js';
import { localized } from '../../i18n/localized.js';
import { code, count, plural, timestamp } from '../../ui/format.js';
import de from './copy.de.js';

const en = {
  commands: {
    trivia: 'Ask a trivia question. First right answer in chat wins.',
    coinflip: 'Flip a coin, or challenge a member to a flip with a stake.',
    higherlower: 'Guess if the next number is higher or lower. Stake something if you like.',
    top: {
      trivia: 'The trivia leaderboard.',
      counting: 'The counting leaderboard.',
      wordchain: 'The word chain leaderboard.',
      higherlower: 'The higher or lower leaderboard.',
      coinflip: 'The coinflip leaderboard.',
    },
  },
  off: (game: string) => `${game} is off here.`,
  wrongChannel: 'Games run in other channels here.',
  economyOff: 'Stakes need Economy, and it is off here.',
  stakeRange: (min: string, max: string) => `Stakes go from ${min} to ${max}.`,
  broke: (balance: string) => `You only have ${balance}.`,
  unknownMember: "That's not a member I can find.",
  names: {
    trivia: 'Trivia',
    counting: 'Counting',
    wordchain: 'Word chain',
    higherlower: 'Higher or lower',
    coinflip: 'Coinflip',
  },
  reward: (amount: string) => `+${amount}`,
  trivia: {
    title: 'Trivia',
    none: 'No questions yet. An admin can add some in the dashboard.',
    running: 'A question is already open here.',
    prompt: (until: Date) => `Answer in chat. Time runs out ${timestamp(until, 'R')}.`,
    won: (userId: string, answer: string) => `${mention.user(userId)} got it: **${answer}**.`,
    timeout: (answer: string) => `Time's up. It was **${answer}**.`,
  },
  counting: {
    broke: (userId: string, reached: number, reset: boolean) =>
      reset
        ? `${mention.user(userId)} broke the count at **${count(reached)}**. Next number is **1**.`
        : `${mention.user(userId)}, that's not it.`,
    twice: (userId: string, reset: boolean) =>
      reset
        ? `${mention.user(userId)} counted twice in a row. Back to **1**.`
        : `${mention.user(userId)}, wait for someone else.`,
    expected: (n: number) => `The next number was ${count(n)}.`,
    milestone: (n: number, userId: string, amount: string) =>
      `**${count(n)}**. ${amount} for ${mention.user(userId)}.`,
  },
  wordchain: {
    letter: (word: string, letter: string) => `**${word}** doesn't start with **${letter}**.`,
    repeat: (word: string) => `**${word}** was used already.`,
    twice: 'Wait for someone else.',
    reset: (reached: number) =>
      reached > 0
        ? `Chain ends at **${count(reached)}**. Start fresh with any word.`
        : 'Start fresh with any word.',
  },
  hilo: {
    running: (channelId: string) =>
      `You already have a game running in ${mention.channel(channelId)}.`,
    start: (n: number, max: number, stake: string | null) =>
      stake
        ? `The number is **${count(n)}** (1 to ${count(max)}). ${stake} on the line.`
        : `The number is **${count(n)}** (1 to ${count(max)}).`,
    how: (until: Date) =>
      `Reply ${code('higher')} or ${code('lower')}, ${code('stop')} to cash out. Ends ${timestamp(until, 'R')}.`,
    right: (n: number, streak: number, worth: string | null) =>
      worth
        ? `**${count(n)}**. Right, ${count(streak)} in a row. Worth ${worth} now.`
        : `**${count(n)}**. Right, ${count(streak)} in a row.`,
    wrong: (n: number, streak: number, lost: string | null) =>
      lost
        ? `**${count(n)}**. Wrong. ${lost} gone after ${plural(streak, 'right guess', 'right guesses')}.`
        : `**${count(n)}**. Wrong. Streak ends at ${count(streak)}.`,
    cashed: (amount: string, streak: number) =>
      `Cashed out ${amount} after ${plural(streak, 'right guess', 'right guesses')}.`,
    refunded: (amount: string) => `Stopped before the first guess. ${amount} back.`,
    stopped: (streak: number) => `Stopped at a streak of ${count(streak)}.`,
    timeout: (userId: string, text: string) => `${mention.user(userId)} ran out of time. ${text}`,
  },
  coinflip: {
    heads: 'Heads.',
    tails: 'Tails.',
    self: "You can't flip against yourself.",
    bot: "Bots don't gamble.",
    busy: 'One of you already has an open coinflip.',
    challenge: (from: string, to: string, stake: string | null) =>
      stake
        ? `${mention.user(to)}, ${mention.user(from)} wants to flip a coin with you for ${stake} each.`
        : `${mention.user(to)}, ${mention.user(from)} wants to flip a coin with you.`,
    confirm: (yes: string, no: string, until: Date) =>
      `React with ${yes} to accept or ${no} to decline. Open until ${timestamp(until, 't')}.`,
    won: (side: string, winner: string, pot: string | null) =>
      pot
        ? `**${side}** ${mention.user(winner)} takes ${pot}.`
        : `**${side}** ${mention.user(winner)} wins.`,
    declined: (userId: string) => `${mention.user(userId)} declined.`,
    cancelled: 'Called off.',
    expired: 'No answer, so nothing happened.',
    failed: "Someone can't cover the stake anymore, so nothing happened.",
  },
  board: {
    title: (game: string) => `${game} leaderboard`,
    empty: ['Nobody is on the board yet.', 'The board is empty. Someone has to start.'],
    wins: (n: number) => plural(n, 'win'),
    best: (n: number) => `best streak ${count(n)}`,
    you: (rank: number, value: string) => `You: #${count(rank)}, ${value}`,
    notYou: 'You are not on the board yet',
  },
};

export type GamesCopy = typeof en;

export const copy = localized(en, { de });

export const gameNames = en.names;

export const auditText = {
  reset: (game: string) => `Reset the ${game} channel`,
};
