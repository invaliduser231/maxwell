import { mention } from '../../commands/mentions.js';
import {
  bold,
  code,
  count,
  escapeMarkdown,
  lines,
  plural,
  subtext,
  timestamp,
} from '../../ui/format.js';
import { andList } from '../../ui/voice.js';
import type { EventsCopy } from './copy.js';

const weekdayLabels: Record<string, string> = {
  mon: 'lunes',
  tue: 'martes',
  wed: 'miércoles',
  thu: 'jueves',
  fri: 'viernes',
  sat: 'sábado',
  sun: 'domingo',
};

const statusWords: Record<string, string> = {
  cancelled: 'cancelado',
  ended: 'terminado',
};

const es: EventsCopy = {
  commands: {
    event: 'Próximos eventos, y planear nuevos.',
    create: 'Planea un evento con confirmación por reacciones.',
    list: 'Muestra los próximos eventos.',
    cancel: 'Cancela un evento.',
    poll: 'Inicia una encuesta con reacciones numéricas.',
  },
  when: {
    missing: 'Para eso necesito una hora y un título.',
    invalid: `No entiendo esa hora. Prueba ${code('fri 20:00')}, ${code('2026-11-02 19:30')} o ${code('in 3h')}.`,
    past: 'Esa hora ya pasó.',
    title: 'El evento necesita un título.',
    long: 'El título debe tener menos de 200 caracteres y la descripción menos de 2.000.',
  },
  created: (title: string, startsAt: Date, channelId: string) =>
    `${bold(title)} es el ${timestamp(startsAt, 'F')}. Publicado en ${mention.channel(channelId)}.`,
  createdHint: (prefix: string, number: number) =>
    subtext(`Evento ${number}. ${code(`${prefix}event cancel ${number}`)} lo cancela.`),
  noChannel: 'No hay ningún canal de eventos configurado y aquí no puedo publicar.',
  listTitle: 'Próximos eventos',
  listLine: (number: number, title: string, startsAt: Date, going: number) =>
    `${code(`#${number}`)}  ${bold(title)}  ${timestamp(startsAt, 'f')}  ${count(going)} van`,
  listEmpty: [
    'Todavía no hay nada planeado.',
    'El calendario está vacío.',
    'No hay eventos a la vista. Semana tranquila.',
  ],
  listHint: (prefix: string) => subtext(`${prefix}event create fri 20:00 Noche de cine`),
  notFound: (number: number) => ({
    content: `Aquí no hay ningún evento ${code(String(number))}.`,
    deleteAfter: 15_000,
  }),
  alreadyOver: (number: number, status: string) => ({
    content: `El evento ${number} ya está ${statusWords[status] ?? status}.`,
    deleteAfter: 15_000,
  }),
  cancelled: (title: string) => `${bold(title)} queda cancelado.`,
  rewardReason: (title: string) => `Evento: ${title}`,

  embed: {
    when: (startsAt: Date) =>
      `**Cuándo** ${timestamp(startsAt, 'F')} (${timestamp(startsAt, 'R')})`,
    until: (endsAt: Date) => `**Hasta** ${timestamp(endsAt, 't')}`,
    repeats: (recurrence: string, weekday: string, day: number) =>
      recurrence === 'daily'
        ? '**Se repite** todos los días'
        : recurrence === 'weekly'
          ? `**Se repite** cada ${weekdayLabels[weekday] ?? weekday}`
          : `**Se repite** cada mes el día ${day}`,
    whereChannel: (channelId: string) => `**Dónde** ${mention.channel(channelId)}`,
    where: (location: string) => `**Dónde** ${location}`,
    counts: (going: number, maybe: number, no: number) =>
      `**${count(going)}** van, **${count(maybe)}** quizás, **${count(no)}** no pueden`,
    more: (left: number) => `y ${count(left)} más`,
    hint: (going: string, maybe: string, no: string) =>
      subtext(`Reacciona con ${going} si vas, ${maybe} si quizás, ${no} si no puedes.`),
    reward: (amount: number, unit: string) =>
      `**Recompensa** ${count(amount)} ${unit} para quienes vayan`,
    cancelled: '**Cancelado.**',
    ended: 'Este ya terminó.',
    footer: (number: number) => `Evento ${number}`,
  },

  reminder: (title: string, startsAt: Date, where: string | null, guildName: string | null) =>
    lines(
      `${bold(title)} empieza ${timestamp(startsAt, 'R')}.`,
      where,
      subtext(guildName ? `${escapeMarkdown(guildName)}. Dijiste que vas.` : `Dijiste que vas.`),
    ),

  poll: {
    problems: {
      question: 'Para eso necesito una pregunta.',
      few: 'Una encuesta necesita al menos dos opciones.',
      many: 'Diez opciones como máximo. Solo hay diez reacciones numéricas.',
      long: 'La pregunta debe tener menos de 250 caracteres y cada opción menos de 100.',
      duplicate: 'Dos de las opciones son iguales.',
    },
    yes: 'Sí',
    no: 'No',
    single: 'Elige una.',
    multiple: 'Elige todas las que quieras.',
    anonymous: 'Los votos son anónimos. Tu reacción desaparece, tu voto se queda.',
    toggle: 'Reacciona otra vez con el mismo número para retirarlo.',
    ends: (endsAt: Date) => `Termina ${timestamp(endsAt, 'R')}.`,
    votersOpen: (voters: number) =>
      voters === 0
        ? 'Todavía no hay votos.'
        : `**${plural(voters, 'persona', 'personas')}** han votado hasta ahora.`,
    votersClosed: (voters: number) =>
      voters === 0 ? 'Nadie votó.' : `**${plural(voters, 'persona', 'personas')}** votaron.`,
    closed: '**Cerrada.**',
    cancelled: '**Cancelada.**',
    footer: (number: number) => `Encuesta ${number}`,
    winner: (question: string, winners: string[], votes: number, total: number) =>
      winners.length === 0
        ? `Encuesta cerrada. Nadie votó en ${bold(question)}.`
        : winners.length === 1
          ? `Encuesta cerrada. Gana ${bold(winners[0] ?? '')} con ${count(votes)} de ${plural(total, 'voto', 'votos')}.`
          : `Encuesta cerrada. Empate entre ${andList(winners.map((winner) => bold(winner)))} con ${plural(votes, 'voto', 'votos')} cada una.`,
    receiptAdded: (question: string, option: string) =>
      lines(
        `Tu voto en ${bold(question)}: ${bold(option)}.`,
        subtext('Reacciona otra vez con el mismo número para retirarlo.'),
      ),
    receiptMoved: (question: string, option: string) =>
      `Cambiaste tu voto en ${bold(question)} a ${bold(option)}.`,
    receiptRemoved: (question: string, option: string) =>
      `Retiraste tu voto por ${bold(option)} en ${bold(question)}.`,
    cardTitle: 'Resultados finales',
    cardVoters: (voters: number, multiple: boolean) =>
      `${plural(voters, 'persona votó', 'personas votaron')}${multiple ? ', con varias opciones permitidas' : ''}`,
    tooLong: 'Una encuesta puede durar 30 días como máximo.',
    noChannel: 'Aquí no puedo publicar la encuesta.',
  },
};

export default es;
