import type { CardCopy } from './copy.js';

const es: CardCopy = {
  level: 'Nivel',
  rank: 'Rango',
  levelWord: 'Nivel ',
  unlocked: 'Desbloqueado: ',
  digest: {
    title: 'Resumen semanal',
    range: (from: string, to: string) => `${from} a ${to}`,
    joins: 'Entradas',
    leaves: 'Salidas',
    net: 'Cambio neto',
    messages: 'Mensajes',
    active: 'Miembros activos',
    inbox: 'Abiertos en la bandeja',
    channels: 'Canales más activos',
    noMessages: 'Ningún mensaje contado',
    deletedChannel: 'Canal eliminado',
    moderation: 'Moderación',
    warn: 'Advertencias',
    timeout: 'Aislamientos',
    kick: 'Expulsiones',
    ban: 'Baneos',
    same: 'Igual que la semana pasada',
    versus: (change: string) => `${change} vs. la semana pasada`,
  },
  activity: {
    title: (days: number) => `Últimos ${days} días`,
    range: (from: string, to: string) => `${from} a ${to}`,
    messages: 'Mensajes',
    active: 'Miembros activos',
    members: 'Cambio de miembros',
    voice: 'Horas en voz',
    perDay: 'Mensajes por día',
    peak: (count: string) => `Día más activo: ${count}`,
    empty: 'Ningún mensaje contado',
    flow: 'Entradas y salidas',
    joined: (count: string) => `${count} entraron`,
    left: (count: string) => `${count} se fueron`,
  },
};

export default es;
