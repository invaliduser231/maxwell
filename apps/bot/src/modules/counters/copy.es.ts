import { mention } from '../../commands/mentions.js';
import { code } from '../../ui/format.js';
import type { CountersCopy } from './copy.js';

const es: CountersCopy = {
  commands: {
    counter: 'Nombres de canal que cuentan.',
    add: 'Crea un canal contador.',
    list: 'Muestra los canales contadores.',
  },
  types: {
    members: 'Miembros',
    online: 'En línea',
    goal: 'Meta de miembros',
    voice: 'En voz',
    channels: 'Canales',
    roles: 'Roles',
    countdown: 'Cuenta atrás',
  },
  templates: {
    members: 'Miembros: {count}',
    online: 'En línea: {count}',
    goal: 'Meta: {count} / {goal}',
    voice: 'En voz: {count}',
    channels: 'Canales: {count}',
    roles: 'Roles: {count}',
    countdown: 'Faltan {count} días',
  },
  unknownType: (types: string) => `Elige uno de estos: ${types}.`,
  needsGoal: (prefix: string) =>
    `Una meta necesita un número, como ${code(`${prefix}counter add goal 1000`)}.`,
  needsDate: (prefix: string) =>
    `Una cuenta atrás necesita una fecha, como ${code(`${prefix}counter add countdown 2027-01-01`)}.`,
  full: (limit: number) => `Esta comunidad ya tiene ${limit} contadores.`,
  created: (channelId: string) =>
    `${mention.channel(channelId)} ya está contando. El nombre se actualiza cada pocos minutos.`,
  failed: 'No pude crear el canal. Revisa que pueda gestionar canales.',
  listTitle: 'Contadores',
  listLine: (channelId: string, type: string) => `${mention.channel(channelId)}  ${type}`,
  empty: (prefix: string) => [
    `Todavía no hay contadores. ${code(`${prefix}counter add members`)} crea uno.`,
    `Todavía no cuenta nada. Prueba ${code(`${prefix}counter add members`)}.`,
  ],
};

export default es;
