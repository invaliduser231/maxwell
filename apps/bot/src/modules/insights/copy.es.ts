import { mention } from '../../commands/mentions.js';
import { count } from '../../ui/format.js';
import type { InsightsCopy } from './copy.js';

const es: InsightsCopy = {
  commands: {
    stats: 'Gráficas de lo activa que está la comunidad.',
    channels: 'Los canales de texto y de voz con más actividad.',
    members: 'Los miembros que más escriben.',
    user: 'Lo activo que ha estado un miembro.',
  },
  channelsTitle: (days: number) => `Canales más activos, últimos ${days} días`,
  text: 'Texto',
  voice: 'Voz',
  channelLine: (rank: number, channelId: string, value: string) =>
    `${rank}. ${mention.channel(channelId)}  ${value}`,
  messages: (value: number) => `${count(value)} ${value === 1 ? 'mensaje' : 'mensajes'}`,
  minutes: (value: number) =>
    value >= 120 ? `${count(Math.round(value / 60))} horas` : `${count(value)} min`,
  nothing: 'Todavía no hay nada contado.',
  membersTitle: (days: number) => `Miembros más activos, últimos ${days} días`,
  memberLine: (rank: number, userId: string, value: string) =>
    `${rank}. ${mention.user(userId)}  ${value}`,
  userTitle: (name: string) => `Actividad de ${name}`,
  userLines: (messages: number, days: number, range: number) =>
    `${count(messages)} ${messages === 1 ? 'mensaje' : 'mensajes'} en ${count(days)} de los últimos ${range} días.`,
  lastSeen: (when: string) => `Activo por última vez ${when}.`,
  quiet: (range: number) => `Ningún mensaje en los últimos ${range} días.`,
  others: 'Solo los moderadores pueden consultar a otros miembros.',
  failed: 'No se pudo dibujar la gráfica. Vuelve a intentarlo en un momento.',
};

export default es;
