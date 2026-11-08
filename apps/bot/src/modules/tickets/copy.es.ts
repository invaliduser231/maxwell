import { mention } from '../../commands/mentions.js';
import { bold, code, lines, subtext, timestamp } from '../../ui/format.js';
import type { TicketTarget } from './config.js';
import type { TicketsCopy } from './copy.js';
import { padNumber } from './naming.js';

type Kind = TicketTarget['kind'];

const es: TicketsCopy = {
  commands: {
    ticket: 'Tickets privados con el equipo.',
    open: 'Abre un ticket privado con el equipo.',
    close: 'Cierra este ticket y guarda una transcripción.',
    claim: 'Toma este ticket. Otra vez para soltarlo.',
    add: 'Deja que un miembro vea este ticket.',
    remove: 'Saca a un miembro de este ticket.',
    rename: 'Cambia el nombre de este canal de ticket.',
    modmail: 'Envía tu próximo MD al equipo de aquí.',
  },
  panelDescription: (kind: Kind, emoji: string) =>
    ({
      support: `¿Necesitas ayuda? Reacciona con ${emoji} para abrir un ticket.`,
      report: `¿Algo va mal por aquí? Reacciona con ${emoji}. Solo el equipo ve tu ticket.`,
      appeal: `¿Quieres que revisen una decisión? Reacciona con ${emoji} para abrir una apelación.`,
      custom: `Reacciona con ${emoji} para abrir un ticket.`,
      modmail: `Reacciona con ${emoji} para abrir un ticket.`,
    })[kind],
  openDefault: (kind: Kind) =>
    ({
      support: 'Cuéntanos qué necesitas. El equipo te atiende en breve.',
      report: 'Cuéntanos qué pasó y quién estuvo involucrado. Los enlaces a mensajes ayudan.',
      appeal: 'Cuéntanos qué decisión quieres que revisemos y por qué.',
      custom: 'El equipo te atiende en breve.',
      modmail: 'Nuevo modmail. Los mensajes de aquí le llegan al miembro por MD.',
    })[kind],
  ticketTitle: (name: string, number: number) => `${name} #${padNumber(number)}`,
  ticketTopic: (name: string, number: number, openerId: string) =>
    `${name} #${padNumber(number)} para ${openerId}`,
  closeHint: (emoji: string) => `Reacciona con ${emoji} para cerrar.`,
  internalHint: (marker: string) =>
    `Empieza un mensaje con ${code(marker)} para que quede interno.`,
  subject: (text: string) => `**Asunto** ${text}`,
  opened: (channelId: string) => `Abierto ${mention.channel(channelId)}.`,
  alreadyOpen: (channelId: string | null) =>
    channelId
      ? `Ya tienes un ticket abierto: ${mention.channel(channelId)}.`
      : 'Ya tienes un ticket abierto.',
  notSetUp:
    'Los tickets todavía no están configurados aquí. Un admin puede añadir un panel en el panel de control.',
  openFailed: 'No pude crear el canal del ticket. Revisa mis permisos en la categoría.',
  inCommunity: 'en esta comunidad',
  theCommunity: 'La comunidad',
  communityFallback: 'la comunidad',
  notTicket: 'Esto no es un ticket abierto.',
  teamOnly: 'Solo el equipo de tickets puede hacer eso.',
  closeNotAllowed: 'Solo el equipo de tickets puede cerrar este.',
  closed: (by: string | null) => (by ? `Cerrado por ${mention.user(by)}.` : 'Cerrado.'),
  closedIdle: 'Cerrado por falta de actividad.',
  reason: (text: string) => `**Motivo** ${text}`,
  goesAway: (at: Date) => subtext(`Este canal desaparece ${timestamp(at, 'R')}.`),
  archived: subtext('El canal se queda como archivo.'),
  claimed: (userId: string) => `${mention.user(userId)} se encarga de este.`,
  unclaimed: 'Ahora nadie se encarga de este.',
  added: (userId: string) => `${mention.user(userId)} ya puede ver este ticket.`,
  removed: (userId: string) => `${mention.user(userId)} ya no ve este ticket.`,
  alreadyAdded: (userId: string) => `${mention.user(userId)} ya está dentro.`,
  notAdded: (userId: string) => `${mention.user(userId)} no estaba añadido a este ticket.`,
  keepOpener: 'Quien abrió el ticket se queda.',
  notMember: 'Esa persona no es miembro de aquí.',
  renamed: (name: string) => `Nuevo nombre: ${code(name)}.`,
  badName: 'Ese nombre no sirve para un canal. Usa letras, números y guiones.',
  reopened: (by: string | null) => (by ? `Reabierto por ${mention.user(by)}.` : 'Reabierto.'),
  cannedUnknown: (prefix: string, names: string[]) =>
    names.length
      ? `No hay ninguna respuesta guardada con ese nombre. Prueba ${names.map((name) => code(`${prefix}${name}`)).join(', ')}.`
      : 'Todavía no hay respuestas guardadas. Añádelas en el panel.',
  modmailSent: (guild: string) =>
    `Enviado al equipo de ${bold(guild)}. Las respuestas aparecen aquí.`,
  modmailPick: (entries: { number: number; name: string }[], page: number, pages: number) =>
    lines(
      '¿Para qué comunidad es? Responde con el número o parte del nombre.',
      ...entries.map((entry) => `${code(String(entry.number))} ${bold(entry.name)}`),
      pages > 1 &&
        subtext(`Página ${page} de ${pages}. Reacciona con las flechas para pasar de página.`),
    ),
  modmailNoMatch: (query: string) =>
    `Ninguna comunidad de la lista coincide con ${bold(query)}. Responde con un número u otra parte del nombre.`,
  modmailExpired: 'Esa lista caducó después de 5 minutos. Aquí tienes una nueva.',
  modmailGone: (guild: string) =>
    `${bold(guild)} no puede recibir tu mensaje ahora mismo. Elige otra.`,
  modmailTryLater: 'No pude revisar tus comunidades ahora. Inténtalo de nuevo en un minuto.',
  modmailReady: (guild: string) => `Escríbeme aquí y llega al equipo de ${bold(guild)}.`,
  modmailCheckDms: 'Revisa tus MD.',
  modmailDmsClosed: 'No puedo enviarte MD. Permite los MD de esta comunidad e inténtalo de nuevo.',
  modmailOff: 'El modmail está desactivado en esta comunidad.',
  modmailOpenHere: 'Ya tienes un modmail abierto aquí. Escríbeme por MD.',
  modmailClosed: (guild: string) => `El equipo de ${bold(guild)} cerró esta conversación.`,
  modmailUnreachable: 'No pude contactar con esa persona. Tiene los MD cerrados.',
  modmailUnavailable: (guild: string) => `${bold(guild)} no puede recibir mensajes ahora mismo.`,
  modmailTeam: (guild: string) => `Equipo de ${guild}`,
  modmailFrom: (guild: string) => `De ${guild}`,
  ratingPrompt: (number: number, guild: string, reactions: boolean) =>
    lines(
      `Tu ticket #${padNumber(number)} en ${bold(guild)} está cerrado.`,
      reactions
        ? '¿Qué tal fue? Reacciona del 1 al 5.'
        : '¿Qué tal fue? Responde con un número del 1 al 5.',
    ),
  ratingThanks: (rating: number) => `Gracias. Anotado ${rating} de 5.`,
  ratingLog: (number: number, rating: number, userId: string) =>
    `El ticket #${padNumber(number)} recibió **${rating} de 5** de ${mention.user(userId)}.`,
  logOpened: 'Ticket abierto',
  logClosed: 'Ticket cerrado',
  logOpener: (userId: string) => `**Abierto por** ${mention.user(userId)}`,
  logClaimed: (userId: string) => `**Atendido por** ${mention.user(userId)}`,
  logClosedBy: (userId: string | null) =>
    userId ? `**Cerrado por** ${mention.user(userId)}` : '**Cerrado por** Maxwell',
  logMessages: (count: string) => `**Mensajes** ${count}`,
  logDuration: (text: string) => `**Abierto durante** ${text}`,
  logTranscript: (url: string) => `[Transcripción](${url})`,
  logChannel: (channelId: string) => `**Canal** ${mention.channel(channelId)}`,
  footerTicket: (number: number, userId: string) => `Ticket ${number} / Usuario ${userId}`,
  footerUser: (userId: string) => `Usuario ${userId}`,
  fromWeb: 'Enviado desde el formulario web.',
};

export default es;
