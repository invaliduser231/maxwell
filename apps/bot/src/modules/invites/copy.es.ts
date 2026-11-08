import { formatDuration } from '../../commands/duration.js';
import { mention } from '../../commands/mentions.js';
import { count, plural } from '../../ui/format.js';
import type { InvitesCopy } from './copy.js';

const es: InvitesCopy = {
  commands: {
    invites: 'Cuántos miembros trajo alguien.',
    top: 'Quién trajo más miembros que se quedaron.',
    who: 'Cómo llegó un miembro y quién lo invitó.',
    log: 'Publica cada entrada con su invitación en un canal.',
  },
  top: {
    empty: [
      'Nadie ha traído a nadie todavía.',
      'La clasificación está vacía. Alguien tiene que empezar.',
      'Todavía no hay invitaciones en la clasificación. Esto está tranquilo.',
    ],
    you: (rank: number, active: number) =>
      `Tú: #${rank} con ${plural(active, 'miembro', 'miembros')}`,
    notOnBoard: 'Todavía no apareces en la clasificación',
    title: 'Los que más invitan',
    left: (n: number) => `${count(n)} se fueron`,
  },
  who: {
    before: (who: string) => `${who} ya estaba aquí antes que yo, así que no sé cómo entró.`,
    looking: (who: string, when: string) => `${who} entró ${when}. Sigo averiguando cómo.`,
    unknown: (who: string, when: string) => `${who} entró ${when}. Fluxer no me dijo cómo.`,
    through: (who: string, when: string, source: string) => `${who} entró ${when} con ${source}.`,
  },
  log: {
    current: (channel: string) => `Las entradas se publican en ${channel}.`,
    off: 'Las publicaciones de entradas están desactivadas.',
    turnOn: (prefix: string) => `Actívalas con ${prefix}invites log #canal.`,
    notChannel: 'Ese canal no lo veo.',
    where: (channel: string) => `en ${channel}`,
    set: (channel: string) => `Desde ahora las entradas van a ${channel}.`,
  },
  stats: {
    selfEmpty: ['Todavía no has traído a nadie.', 'Nadie ha entrado gracias a ti todavía.'],
    otherEmpty: (who: string) => `${who} todavía no ha traído a nadie.`,
    you: 'Tú',
    stayedOne: 'Se quedó.',
    stayedAll: 'Se quedaron todos.',
    stillHere: (n: number) => `${count(n)} siguen aquí.`,
    brought: (subject: string, total: number, stayed: string) =>
      `${subject}: **${plural(total, 'miembro', 'miembros')}** traídos. ${stayed}`,
    leftAgain: (n: number) => `${count(n)} se fueron otra vez`,
  },
  source: {
    inviteFrom: (code: string, inviterId: string) => `\`${code}\` de ${mention.user(inviterId)}`,
    invite: 'una invitación',
    vanity: 'el enlace personalizado',
    discovery: 'el explorador',
    bot: 'una invitación de bot',
    creator: 'la creación de la comunidad',
    admin: 'un admin de la instancia',
    unknown: 'una vía desconocida',
  },
  join: {
    through: (who: string, source: string) => `${who} entró con ${source}.`,
    plain: (who: string) => `${who} entró.`,
    needsPermission: 'Necesito Manage Community para ver qué invitación se usó.',
    notTold: 'Fluxer no me dijo qué invitación se usó.',
    botTitle: 'Bot añadido',
    memberTitle: 'Miembro se unió',
    inviterNow: (inviter: string, active: number) =>
      `${inviter} ya tiene **${plural(active, 'miembro', 'miembros')}** aquí.`,
    created: 'Cuenta creada',
    young: (age: number) => `La cuenta solo tiene ${formatDuration(age)}.`,
    number: (n: number) => `Miembro #${count(n)}`,
  },
};

export default es;
