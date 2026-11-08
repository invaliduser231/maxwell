import { mention } from '../../commands/mentions.js';
import { bold, count, plural, timestamp } from '../../ui/format.js';
import { andList } from '../../ui/voice.js';
import type { GiveawaysCopy } from './copy.js';
import type { Unmet } from './draw.js';

const es: GiveawaysCopy = {
  giveawayDescription: 'Inicia, termina y vuelve a sortear sorteos.',
  startDescription: 'Inicia un sorteo aquí o en otro canal.',
  endDescription: 'Termina un sorteo ahora y elige a los ganadores.',
  rerollDescription: 'Elige nuevos ganadores para un sorteo terminado.',
  listDescription: 'Sorteos en curso y programados.',

  enter: (emoji: string) => `Reacciona con ${emoji} para participar.`,
  ends: (at: Date) => `**Termina** ${timestamp(at, 'R')} (${timestamp(at, 'f')})`,
  ended: (at: Date) => `**Terminó** ${timestamp(at, 'R')}`,
  winnersCount: (n: number) => `**Ganadores** ${count(n)}`,
  winnersList: (ids: readonly string[]) => `**Ganadores** ${ids.map(mention.user).join(', ')}`,
  rerolled: (ids: readonly string[]) => `**Nuevo sorteo** ${ids.map(mention.user).join(', ')}`,
  noWinners: 'No hubo participaciones válidas, así que nadie ganó.',
  host: (id: string) => `**Organizado por** ${mention.user(id)}`,
  entries: (n: number) => `**Participaciones** ${count(n)}`,
  needs: (parts: readonly string[]) => `**Requisitos** ${parts.join(', ')}`,
  needRole: (roleId: string) => mention.role(roleId),
  needLevel: (level: number) => `nivel ${count(level)}`,
  needDays: (days: number) => `${plural(days, 'día', 'días')} en la comunidad`,
  notFor: (roleId: string) => `**No para** ${mention.role(roleId)}`,
  bonus: (parts: readonly { roleId: string; entries: number }[]) =>
    `**Participaciones extra** ${parts.map((part) => `${mention.role(part.roleId)} +${part.entries}`).join(', ')}`,
  footer: (number: number) => `Sorteo ${number}`,

  won: (ids: readonly string[], prize: string) =>
    `${andList(ids.map(mention.user))} ${ids.length === 1 ? 'ganó' : 'ganaron'} ${bold(prize)}.`,
  nobodyWon: (prize: string) =>
    `Nadie participó en el sorteo de ${bold(prize)}, así que no hay ganador.`,
  newWinners: (ids: readonly string[], prize: string) =>
    `${ids.length === 1 ? 'Nuevo ganador' : 'Nuevos ganadores'} de ${bold(prize)}: ${andList(ids.map(mention.user))}.`,
  nobodyLeft: (prize: string) => `No queda nadie a quien sortear para ${bold(prize)}.`,
  wonDirect: (prize: string, server: string) => `Ganaste ${bold(prize)} en ${bold(server)}.`,
  theCommunity: 'la comunidad',
  inChannel: (channelId: string) => `en ${mention.channel(channelId)}`,

  unmet: (
    reason: Unmet,
    prize: string,
    detail: { role: string | null; level: number; days: number },
  ) => {
    const lead = `Todavía no puedes participar en el sorteo de ${bold(prize)}.`;
    switch (reason) {
      case 'excluded':
        return detail.role
          ? `${lead} Los miembros con el rol ${bold(detail.role)} no pueden participar.`
          : `${lead} Uno de tus roles no puede participar.`;
      case 'role':
        return detail.role
          ? `${lead} Necesitas el rol ${bold(detail.role)}.`
          : `${lead} Necesitas un rol que no tienes.`;
      case 'level':
        return `${lead} Necesitas el nivel ${count(detail.level)}.`;
      case 'age':
        return `${lead} Necesitas ${plural(detail.days, 'día', 'días')} en la comunidad.`;
    }
  },

  started: (number: number, channelId: string) =>
    `El sorteo ${number} está en curso en ${mention.channel(channelId)}.`,
  endedNow: (number: number) => `El sorteo ${number} terminó.`,
  rerolledNow: (number: number) => `Los nuevos ganadores del sorteo ${number} están publicados.`,
  tooShort: 'Un sorteo dura al menos un minuto.',
  tooLong: 'Un sorteo puede durar 60 días como máximo.',
  prizeTooLong: 'El premio debe tener menos de 256 caracteres.',
  badOption: (flag: string) =>
    `No entiendo \`--${flag}\`. Las opciones son \`--role\`, \`--not\` y \`--ping\` con un rol, \`--level\` y \`--days\` con un número, y \`--nodm\`.`,
  notFound: (number: number) => `Aquí no hay ningún sorteo ${number}.`,
  noneRunning: 'No hay ningún sorteo en curso.',
  noneEnded: 'Todavía no ha terminado ningún sorteo.',
  notRunning: (number: number) => `El sorteo ${number} no está en curso.`,
  notEnded: (number: number) => `El sorteo ${number} todavía no ha terminado.`,
  channelGone: 'Ese canal no lo veo.',
  listTitle: 'Sorteos',
  listRunning: (number: number, prize: string, channelId: string, endsAt: Date, winners: number) =>
    `\`${number}\` ${bold(prize)} en ${mention.channel(channelId)}, termina ${timestamp(endsAt, 'R')}, ${plural(winners, 'ganador', 'ganadores')}`,
  listScheduled: (number: number, prize: string, channelId: string, startsAt: Date) =>
    `\`${number}\` ${bold(prize)} en ${mention.channel(channelId)}, empieza ${timestamp(startsAt, 'R')}`,
  emptyList: [
    'No hay sorteos en curso. La generosidad se tomó un descanso.',
    'Nada en curso ahora mismo.',
  ],
};

export default es;
