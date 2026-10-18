import { mention } from '../../commands/mentions.js';
import { code, count, plural, timestamp } from '../../ui/format.js';
import type { GamesCopy } from './copy.js';

const de: GamesCopy = {
  commands: {
    trivia: 'Stellt eine Quizfrage. Die erste richtige Antwort im Chat gewinnt.',
    coinflip: 'Wirft eine Münze oder fordert jemanden zum Münzwurf mit Einsatz heraus.',
    higherlower: 'Rate, ob die nächste Zahl höher oder tiefer ist. Mit Einsatz, wenn du magst.',
    top: {
      trivia: 'Die Quiz-Rangliste.',
      counting: 'Die Rangliste beim Zählen.',
      wordchain: 'Die Wortketten-Rangliste.',
      higherlower: 'Die Rangliste bei Höher oder tiefer.',
      coinflip: 'Die Münzwurf-Rangliste.',
    },
  },
  off: (game: string) => `${game} ist hier aus.`,
  wrongChannel: 'Spiele laufen hier in anderen Kanälen.',
  economyOff: 'Einsätze brauchen Economy, und das ist hier aus.',
  stakeRange: (min: string, max: string) => `Einsätze gehen von ${min} bis ${max}.`,
  broke: (balance: string) => `Du hast nur ${balance}.`,
  unknownMember: 'Dieses Mitglied finde ich nicht.',
  names: {
    trivia: 'Quiz',
    counting: 'Zählen',
    wordchain: 'Wortkette',
    higherlower: 'Höher oder tiefer',
    coinflip: 'Münzwurf',
  },
  reward: (amount: string) => `+${amount}`,
  trivia: {
    title: 'Quiz',
    none: 'Noch keine Fragen. Ein Admin kann im Dashboard welche anlegen.',
    running: 'Hier ist schon eine Frage offen.',
    prompt: (until: Date) => `Antworte im Chat. Die Zeit läuft ${timestamp(until, 'R')} ab.`,
    won: (userId: string, answer: string) => `${mention.user(userId)} hat es: **${answer}**.`,
    timeout: (answer: string) => `Zeit um. Gesucht war **${answer}**.`,
  },
  counting: {
    broke: (userId: string, reached: number, reset: boolean) =>
      reset
        ? `${mention.user(userId)} hat bei **${count(reached)}** verzählt. Weiter geht es mit **1**.`
        : `${mention.user(userId)}, das passt nicht.`,
    twice: (userId: string, reset: boolean) =>
      reset
        ? `${mention.user(userId)} hat zweimal hintereinander gezählt. Zurück auf **1**.`
        : `${mention.user(userId)}, lass erst jemand anderen.`,
    expected: (n: number) => `Die nächste Zahl wäre ${count(n)} gewesen.`,
    milestone: (n: number, userId: string, amount: string) =>
      `**${count(n)}**. ${amount} für ${mention.user(userId)}.`,
  },
  wordchain: {
    letter: (word: string, letter: string) => `**${word}** fängt nicht mit **${letter}** an.`,
    repeat: (word: string) => `**${word}** gab es schon.`,
    twice: 'Lass erst jemand anderen.',
    reset: (reached: number) =>
      reached > 0
        ? `Die Kette endet bei **${count(reached)}**. Fang mit einem beliebigen Wort neu an.`
        : 'Fang mit einem beliebigen Wort neu an.',
  },
  hilo: {
    running: (channelId: string) =>
      `Du hast schon ein Spiel in ${mention.channel(channelId)} laufen.`,
    start: (n: number, max: number, stake: string | null) =>
      stake
        ? `Die Zahl ist **${count(n)}** (1 bis ${count(max)}). ${stake} stehen auf dem Spiel.`
        : `Die Zahl ist **${count(n)}** (1 bis ${count(max)}).`,
    how: (until: Date) =>
      `Antworte mit ${code('höher')} oder ${code('tiefer')}, mit ${code('stopp')} nimmst du den Gewinn mit. Endet ${timestamp(until, 'R')}.`,
    right: (n: number, streak: number, worth: string | null) =>
      worth
        ? `**${count(n)}**. Richtig, ${count(streak)} in Folge. Jetzt ${worth} wert.`
        : `**${count(n)}**. Richtig, ${count(streak)} in Folge.`,
    wrong: (n: number, streak: number, lost: string | null) =>
      lost
        ? `**${count(n)}**. Falsch. ${lost} sind nach ${plural(streak, 'richtigen Tipp', 'richtigen Tipps')} weg.`
        : `**${count(n)}**. Falsch. Die Serie endet bei ${count(streak)}.`,
    cashed: (amount: string, streak: number) =>
      `${amount} mitgenommen nach ${plural(streak, 'richtigen Tipp', 'richtigen Tipps')}.`,
    refunded: (amount: string) => `Vor dem ersten Tipp aufgehört. ${amount} zurück.`,
    stopped: (streak: number) => `Bei einer Serie von ${count(streak)} aufgehört.`,
    timeout: (userId: string, text: string) => `${mention.user(userId)} war zu langsam. ${text}`,
  },
  coinflip: {
    heads: 'Kopf.',
    tails: 'Zahl.',
    self: 'Gegen dich selbst geht das nicht.',
    bot: 'Bots zocken nicht.',
    busy: 'Einer von euch hat schon einen offenen Münzwurf.',
    challenge: (from: string, to: string, stake: string | null) =>
      stake
        ? `${mention.user(to)}, ${mention.user(from)} will mit dir um je ${stake} eine Münze werfen.`
        : `${mention.user(to)}, ${mention.user(from)} will mit dir eine Münze werfen.`,
    confirm: (yes: string, no: string, until: Date) =>
      `Reagier mit ${yes} zum Annehmen oder ${no} zum Ablehnen. Offen bis ${timestamp(until, 't')}.`,
    won: (side: string, winner: string, pot: string | null) =>
      pot
        ? `**${side}** ${mention.user(winner)} bekommt ${pot}.`
        : `**${side}** ${mention.user(winner)} gewinnt.`,
    declined: (userId: string) => `${mention.user(userId)} hat abgelehnt.`,
    cancelled: 'Abgeblasen.',
    expired: 'Keine Antwort, also ist nichts passiert.',
    failed: 'Jemand kann den Einsatz nicht mehr zahlen, also ist nichts passiert.',
  },
  board: {
    title: (game: string) => `Rangliste ${game}`,
    empty: ['Noch steht niemand auf der Liste.', 'Die Liste ist leer. Irgendwer muss anfangen.'],
    wins: (n: number) => plural(n, 'Sieg', 'Siege'),
    best: (n: number) => `beste Serie ${count(n)}`,
    you: (rank: number, value: string) => `Du: Platz ${count(rank)}, ${value}`,
    notYou: 'Du stehst noch nicht auf der Liste',
  },
};

export default de;
