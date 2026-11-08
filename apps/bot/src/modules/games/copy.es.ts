import { mention } from '../../commands/mentions.js';
import { code, count, plural, timestamp } from '../../ui/format.js';
import type { GamesCopy } from './copy.js';

const es: GamesCopy = {
  commands: {
    trivia: 'Hace una pregunta de trivia. Gana la primera respuesta correcta en el chat.',
    coinflip: 'Lanza una moneda o reta a un miembro a un lanzamiento con apuesta.',
    higherlower: 'Adivina si el siguiente número es mayor o menor. Con apuesta, si quieres.',
    top: {
      trivia: 'La clasificación de trivia.',
      counting: 'La clasificación de conteo.',
      wordchain: 'La clasificación de cadena de palabras.',
      higherlower: 'La clasificación de mayor o menor.',
      coinflip: 'La clasificación de cara o cruz.',
    },
  },
  off: (game: string) => `${game} está desactivado aquí.`,
  wrongChannel: 'Aquí los juegos van en otros canales.',
  economyOff: 'Las apuestas necesitan Economy, y está desactivado aquí.',
  stakeRange: (min: string, max: string) => `Las apuestas van de ${min} a ${max}.`,
  broke: (balance: string) => `Solo tienes ${balance}.`,
  unknownMember: 'No encuentro a ese miembro.',
  names: {
    trivia: 'Trivia',
    counting: 'Conteo',
    wordchain: 'Cadena de palabras',
    higherlower: 'Mayor o menor',
    coinflip: 'Cara o cruz',
  },
  reward: (amount: string) => `+${amount}`,
  trivia: {
    title: 'Trivia',
    none: 'Todavía no hay preguntas. Un admin puede añadir algunas en el panel.',
    running: 'Ya hay una pregunta abierta aquí.',
    prompt: (until: Date) => `Responde en el chat. El tiempo se acaba ${timestamp(until, 'R')}.`,
    won: (userId: string, answer: string) => `${mention.user(userId)} acertó: **${answer}**.`,
    timeout: (answer: string) => `Se acabó el tiempo. Era **${answer}**.`,
  },
  counting: {
    broke: (userId: string, reached: number, reset: boolean) =>
      reset
        ? `${mention.user(userId)} rompió la cuenta en **${count(reached)}**. El siguiente número es **1**.`
        : `${mention.user(userId)}, ese no es.`,
    twice: (userId: string, reset: boolean) =>
      reset
        ? `${mention.user(userId)} contó dos veces seguidas. De vuelta a **1**.`
        : `${mention.user(userId)}, espera a que cuente otra persona.`,
    expected: (n: number) => `El siguiente número era ${count(n)}.`,
    milestone: (n: number, userId: string, amount: string) =>
      `**${count(n)}**. ${amount} para ${mention.user(userId)}.`,
  },
  wordchain: {
    letter: (word: string, letter: string) => `**${word}** no empieza por **${letter}**.`,
    repeat: (word: string) => `**${word}** ya se usó.`,
    twice: 'Espera a que juegue otra persona.',
    reset: (reached: number) =>
      reached > 0
        ? `La cadena termina en **${count(reached)}**. Empieza de nuevo con cualquier palabra.`
        : 'Empieza de nuevo con cualquier palabra.',
  },
  hilo: {
    running: (channelId: string) =>
      `Ya tienes una partida en curso en ${mention.channel(channelId)}.`,
    start: (n: number, max: number, stake: string | null) =>
      stake
        ? `El número es **${count(n)}** (de 1 a ${count(max)}). Hay ${stake} en juego.`
        : `El número es **${count(n)}** (de 1 a ${count(max)}).`,
    how: (until: Date) =>
      `Responde ${code('higher')} o ${code('lower')}, o ${code('stop')} para cobrar. Termina ${timestamp(until, 'R')}.`,
    right: (n: number, streak: number, worth: string | null) =>
      worth
        ? `**${count(n)}**. Correcto, ${count(streak)} seguidos. Ahora vale ${worth}.`
        : `**${count(n)}**. Correcto, ${count(streak)} seguidos.`,
    wrong: (n: number, streak: number, lost: string | null) =>
      lost
        ? `**${count(n)}**. Incorrecto. Pierdes ${lost} después de ${plural(streak, 'acierto', 'aciertos')}.`
        : `**${count(n)}**. Incorrecto. La racha termina en ${count(streak)}.`,
    cashed: (amount: string, streak: number) =>
      `Cobraste ${amount} después de ${plural(streak, 'acierto', 'aciertos')}.`,
    refunded: (amount: string) => `Paraste antes del primer intento. Te devuelvo ${amount}.`,
    stopped: (streak: number) => `Paraste con una racha de ${count(streak)}.`,
    timeout: (userId: string, text: string) =>
      `A ${mention.user(userId)} se le acabó el tiempo. ${text}`,
  },
  coinflip: {
    heads: 'Cara.',
    tails: 'Cruz.',
    self: 'No puedes lanzar contra ti.',
    bot: 'Los bots no apuestan.',
    busy: 'Uno de ustedes ya tiene un cara o cruz abierto.',
    challenge: (from: string, to: string, stake: string | null) =>
      stake
        ? `${mention.user(to)}, ${mention.user(from)} quiere lanzar una moneda contigo por ${stake} cada uno.`
        : `${mention.user(to)}, ${mention.user(from)} quiere lanzar una moneda contigo.`,
    confirm: (yes: string, no: string, until: Date) =>
      `Reacciona con ${yes} para aceptar o ${no} para rechazar. Abierto hasta ${timestamp(until, 't')}.`,
    won: (side: string, winner: string, pot: string | null) =>
      pot
        ? `**${side}** ${mention.user(winner)} se lleva ${pot}.`
        : `**${side}** Gana ${mention.user(winner)}.`,
    declined: (userId: string) => `${mention.user(userId)} rechazó.`,
    cancelled: 'Cancelado.',
    expired: 'Sin respuesta, así que no pasó nada.',
    failed: 'Alguien ya no puede cubrir la apuesta, así que no pasó nada.',
  },
  board: {
    title: (game: string) => `Clasificación de ${game}`,
    empty: [
      'Todavía no hay nadie en la clasificación.',
      'La clasificación está vacía. Alguien tiene que empezar.',
    ],
    wins: (n: number) => plural(n, 'victoria', 'victorias'),
    best: (n: number) => `mejor racha ${count(n)}`,
    you: (rank: number, value: string) => `Tú: #${count(rank)}, ${value}`,
    notYou: 'Todavía no estás en la clasificación',
  },
};

export default es;
