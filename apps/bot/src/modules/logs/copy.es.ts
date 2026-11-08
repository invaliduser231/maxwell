import { count, plural } from '../../ui/format.js';
import type { LogsCopy } from './copy.js';

const es: LogsCopy = {
  titles: {
    messageDelete: 'Mensaje eliminado',
    messageEdit: 'Mensaje editado',
    messageBulkDelete: 'Mensajes eliminados en masa',
    memberJoin: 'Miembro se unió',
    botJoin: 'Bot añadido',
    memberLeave: 'Miembro se fue',
    memberRoles: 'Roles cambiados',
    nickname: 'Apodo cambiado',
    timeoutSet: 'Miembro aislado',
    timeoutCleared: 'Aislamiento retirado',
    roleCreate: 'Rol creado',
    roleUpdate: 'Rol actualizado',
    roleDelete: 'Rol eliminado',
    channelCreate: 'Canal creado',
    channelUpdate: 'Canal actualizado',
    channelDelete: 'Canal eliminado',
    threadCreate: 'Hilo creado',
    threadUpdate: 'Hilo actualizado',
    threadDelete: 'Hilo eliminado',
    voiceJoin: 'Entró a voz',
    voiceLeave: 'Salió de voz',
    voiceMove: 'Cambió de canal de voz',
    inviteCreate: 'Invitación creada',
    inviteDelete: 'Invitación eliminada',
    ban: 'Miembro baneado',
    unban: 'Baneo retirado',
    kick: 'Miembro expulsado',
  },

  labels: {
    before: 'Antes',
    after: 'Después',
    added: 'Añadidos',
    removed: 'Quitados',
    name: 'Nombre',
    color: 'Color',
    permissions: 'Permisos',
    category: 'Categoría',
    parent: 'En',
    type: 'Tipo',
    accountCreated: 'Cuenta creada',
    channel: 'Canal',
    inviter: 'Creada por',
    until: 'Hasta',
    attachments: 'Adjuntos',
    hoist: 'Mostrar por separado',
    mentionable: 'Mencionable',
    by: 'Por',
    reason: 'Motivo',
  },

  inChannel: (channel: string, sent: string | null) =>
    sent ? `en ${channel}, enviado ${sent}` : `en ${channel}`,
  unknownContent: 'El texto no estaba en mi caché.',
  emptyContent: 'Sin texto.',
  noNickname: '*sin apodo*',
  noCategory: '*sin categoría*',
  youngAccount: (age: string) => `La cuenta solo tiene ${age}.`,
  age: (ms: number) => {
    const hours = Math.floor(ms / 3_600_000);
    if (hours < 1) return plural(Math.max(Math.floor(ms / 60_000), 1), 'minuto');
    if (hours < 48) return plural(hours, 'hora');
    return plural(Math.floor(hours / 24), 'día', 'días');
  },
  bulkSummary: (n: number, channel: string) => `**${count(n)}** mensajes en ${channel}`,
  bulkCached: (known: number, total: number) =>
    known === 0
      ? 'Ninguno estaba en mi caché.'
      : known === total
        ? 'Va adjunto el texto de todos.'
        : `Va adjunto el texto de ${count(known)} de ellos.`,
  bulkFile: 'mensajes-eliminados.txt',
  bulkUnknownAuthor: 'desconocido',
  voiceJoined: (user: string, channel: string) => `${user} entró a ${channel}.`,
  voiceLeft: (user: string, channel: string) => `${user} salió de ${channel}.`,
  voiceMoved: (user: string, from: string, to: string) => `${user} pasó de ${from} a ${to}.`,
  inviteLine: (code: string, channel: string | null) =>
    channel ? `\`${code}\` para ${channel}` : `\`${code}\``,
  memberCount: (n: number) => `Miembro #${count(n)}`,
  userFooter: (id: string) => `Usuario ${id}`,
  messageFooter: (userId: string | null, messageId: string) =>
    userId ? `Usuario ${userId} / Mensaje ${messageId}` : `Mensaje ${messageId}`,
  roleFooter: (id: string) => `Rol ${id}`,
  channelFooter: (id: string) => `Canal ${id}`,
  timeoutUntil: (when: string, relative: string) => `${when} (${relative})`,
  change: (label: string, before: string, after: string) => `**${label}** ${before} a ${after}`,
  permissionsChanged: 'Cambiados',
  more: (n: number) => `y ${plural(n, 'más', 'más')}`,
  testNote: 'Esta es una entrada de prueba. Las entradas reales se ven así.',

  channelTypes: {
    0: 'Texto',
    2: 'Voz',
    4: 'Categoría',
    5: 'Anuncios',
    10: 'Hilo de anuncios',
    11: 'Hilo',
    12: 'Hilo privado',
    15: 'Foro',
    16: 'Multimedia',
  } as Record<number, string>,
};

export default es;
