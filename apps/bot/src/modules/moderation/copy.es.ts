import type { CaseAction, EscalationAction } from '@maxwell/core/modules/moderation';
import { code, count, plural } from '../../ui/format.js';
import type { ModerationCopy } from './copy.js';
import { humanDuration } from './text.js';

const escalationNouns: Record<EscalationAction, string> = {
  timeout: 'Un aislamiento',
  kick: 'Una expulsión',
  ban: 'Un baneo',
};

const suggestionNouns: Record<EscalationAction, string> = {
  timeout: 'aislamiento',
  kick: 'expulsión',
  ban: 'baneo',
};

const es: ModerationCopy = {
  commands: {
    ban: 'Banea a un miembro, para siempre o por un tiempo.',
    unban: 'Quita un baneo.',
    kick: 'Expulsa a un miembro. Puede volver con una invitación.',
    timeout: 'Aísla a un miembro por un tiempo. Puede leer, pero no escribir.',
    untimeout: 'Termina un aislamiento antes de tiempo.',
    warn: 'Advierte a un miembro. Las advertencias suman en la escala de sanciones.',
    caseVoid: 'Anula un caso. Deja de contar para la escala de sanciones.',
    case: 'Muestra un caso.',
    cases: 'Muestra los casos recientes o el historial de un miembro.',
    reason: 'Pone o cambia el motivo de un caso.',
    warningsClear: 'Anula todas las advertencias activas de un miembro.',
    warnings: 'Muestra las advertencias activas de un miembro.',
    lock: 'Impide que los miembros escriban en un canal. La moderación puede seguir hablando.',
    unlock: 'Vuelve a abrir un canal bloqueado.',
    slowmode: 'Define cuánto esperan los miembros entre mensajes en un canal.',
    purge: 'Borra los mensajes recientes de este canal, con filtro si quieres.',
    massban: 'Banea a varios miembros a la vez por ID o mención.',
    noteRemove: 'Elimina una nota.',
    note: 'Añade una nota privada a la ficha de un miembro. Solo la moderación ve las notas.',
    notes: 'Te envía por MD las notas sobre un miembro.',
  },

  actions: {
    ban: 'Baneo',
    unban: 'Baneo retirado',
    kick: 'Expulsión',
    timeout: 'Aislamiento',
    untimeout: 'Aislamiento retirado',
    warn: 'Advertencia',
    flag: 'Revisión',
  } as Record<CaseAction, string>,

  noReason: 'Sin motivo',
  maxwell: 'Maxwell',
  unknown: 'Desconocido',
  permanent: 'Permanente',
  dmTemplate:
    'Te {action} en **{server}**.\nMotivo: {reason}\n-# Las preguntas van al equipo de la comunidad, no a mí.',

  done: {
    ban: (who: string, n: number, duration: string | null) =>
      duration
        ? `${who} está baneado durante ${duration}. Caso #${n}.`
        : `${who} fue baneado. Caso #${n}.`,
    unban: (who: string, n: number) => `Se retiró el baneo de ${who}. Caso #${n}.`,
    kick: (who: string, n: number) => `${who} fue expulsado. Caso #${n}.`,
    timeout: (who: string, n: number, duration: string) =>
      `${who} está aislado durante ${duration}. Caso #${n}.`,
    untimeout: (who: string, n: number) => `${who} puede volver a hablar. Caso #${n}.`,
    warn: (who: string, n: number, active: number) =>
      `${who} recibió una advertencia (${active}.ª). Caso #${n}.`,
  },

  addReason: (prefix: string, n: number) =>
    `Sin motivo. Añade uno con ${prefix}reason ${n} <texto>.`,
  dmFailed: 'No acepta MD, así que no se le avisó.',

  escalated: (
    active: number,
    days: number,
    who: string,
    action: EscalationAction,
    duration: string | null,
    n: number,
  ) => {
    const lead = `Son ${active} advertencias en ${days} días, así que`;
    if (action === 'timeout')
      return `${lead} ${who} queda aislado durante ${duration}. Caso #${n}.`;
    if (action === 'kick') return `${lead} ${who} fue expulsado. Caso #${n}.`;
    return duration
      ? `${lead} ${who} queda baneado durante ${duration}. Caso #${n}.`
      : `${lead} ${who} fue baneado. Caso #${n}.`;
  },
  escalatedReview: (active: number, days: number, action: EscalationAction, n: number) =>
    `Son ${active} advertencias en ${days} días. ${escalationNouns[action]} espera revisión en el registro de moderación. Caso #${n}.`,
  escalationFailed: (who: string) =>
    `No pude aplicar la sanción a ${who}. Revisa mi rol y mis permisos.`,
  reviewSuggestion: (action: EscalationAction, duration: string | null) =>
    duration
      ? `Sugerencia: ${suggestionNouns[action]} durante ${duration}.`
      : `Sugerencia: ${suggestionNouns[action]}.`,
  reviewApproved: (by: string) => `Aprobado por ${by}.`,
  reviewDeclined: (by: string) => `Rechazado por ${by}.`,

  dmAction: {
    warn: () => 'advirtieron',
    timeout: (duration: string) => `aislaron durante ${duration}`,
    kick: () => 'expulsaron',
    ban: (duration: string | null) => (duration ? `banearon durante ${duration}` : 'banearon'),
  },

  errors: {
    reasonRequired: 'Aquí hace falta un motivo.',
    self: 'No puedes hacerte eso a ti.',
    me: 'Conmigo no.',
    notMember: (who: string) => `${who} no está en esta comunidad.`,
    higher: (who: string) => `${who} tiene un rol igual o superior al tuyo.`,
    admin: (who: string) => `${who} es admin.`,
    botLower: (who: string) =>
      `No puedo actuar sobre ${who}. Mi rol más alto tiene que estar por encima del suyo.`,
    forbidden: (verb: string, who: string) =>
      `Fluxer no me dejó ${verb} a ${who}. Revisa mi rol y mis permisos.`,
    notBanned: (who: string) => `${who} no está baneado.`,
    notTimedOut: (who: string) => `${who} no está aislado.`,
    timeoutRange: 'Un aislamiento puede durar hasta 365 días.',
    banRange: 'Un baneo temporal puede durar de 1 minuto a 2 años.',
    noCase: (n: number) => `No existe el caso #${n}.`,
    alreadyVoid: (n: number) => `El caso #${n} ya está anulado.`,
    noNote: (number: number) => `No existe la nota #${number}.`,
    noChannel: 'No veo ese canal.',
  },

  verbs: {
    ban: 'banear',
    unban: 'desbanear',
    kick: 'expulsar',
    timeout: 'aislar',
    untimeout: 'quitarle el aislamiento',
  } as Record<string, string>,

  fields: {
    member: 'Miembro',
    moderator: 'Moderación',
    duration: 'Duración',
    reason: 'Motivo',
    evidence: 'Pruebas',
    excerpt: 'Mensaje',
    editedBy: 'Editado por',
    voided: 'Anulado',
    channel: 'Canal',
    ended: 'Terminado',
  },
  caseTitle: (n: number, title: string, voided: boolean) =>
    `Caso ${n}: ${title}${voided ? ' (anulado)' : ''}`,
  caseFooter: (userId: string | null, n: number) =>
    userId ? `Usuario ${userId} / Caso ${n}` : `Caso ${n}`,
  channelFooter: (id: string) => `Canal ${id}`,
  userFooter: (id: string) => `Usuario ${id}`,
  reasonHint: (prefix: string, n: number) =>
    `Sin motivo. ${code(`${prefix}reason ${n} <texto>`)} añade uno.`,
  voidedLine: (by: string, when: string, reason: string | null) =>
    reason ? `Por ${by} ${when}. ${reason}` : `Por ${by} ${when}.`,

  risk: {
    newAccount: (ageMs: number) => `La cuenta tiene ${humanDuration(ageMs)}.`,
    recentJoin: 'Entró en las últimas 24 horas.',
    names: (n: number) => `Cambió de nombre ${count(n)} veces.`,
    warns: (n: number) => `${plural(n, 'advertencia activa', 'advertencias activas')}.`,
    banned: (n: number) =>
      n === 1 ? 'Ya fue baneado aquí antes.' : `Ya fue baneado aquí ${count(n)} veces.`,
  },

  cases: {
    title: 'Casos',
    titleFor: (name: string) => `Casos de ${name}`,
    empty: [
      'Todavía no hay casos. Todo tranquilo.',
      'No hay casos registrados.',
      'Todavía no hay nada registrado.',
    ],
    emptyFor: (who: string) => `No hay casos de ${who}. Historial limpio.`,
    by: (who: string) => `por ${who}`,
    summary: (total: number, warns: number, notes: number) =>
      `${plural(total, 'caso', 'casos')}, ${plural(warns, 'advertencia activa', 'advertencias activas')}, ${plural(notes, 'nota', 'notas')}`,
    names: 'Nombres anteriores',
  },

  warnings: {
    title: (name: string) => `Advertencias de ${name}`,
    empty: (who: string) => `${who} no tiene advertencias activas. Historial limpio.`,
    expires: (when: string) => `caduca ${when}`,
    cleared: (n: number, who: string) =>
      `Se quitaron ${plural(n, 'advertencia', 'advertencias')} a ${who}.`,
    undoHint: '¿Cambiaste de idea? Deshazlo en el registro de auditoría.',
  },

  reason: {
    set: (n: number) => `El caso #${n} tiene un motivo nuevo.`,
  },
  voided: (n: number) => `El caso #${n} está anulado.`,

  notes: {
    added: (who: string) => `Nota añadida sobre ${who}.`,
    title: (name: string) => `Notas sobre ${name}`,
    empty: (who: string) => `No hay notas sobre ${who}.`,
    sent: 'Te lo envié por MD.',
    removed: (number: number) => `Nota #${number} eliminada.`,
    line: (number: number, when: string, by: string) => `**#${number}** ${when} ${by}`,
  },

  purge: {
    working: 'Trabajando en ello.',
    progress: (done: number, total: number) => `Borrados ${count(done)} de ${count(total)}.`,
    done: (n: number, seconds: number | null) =>
      seconds !== null && seconds >= 3
        ? `Borré ${plural(n, 'mensaje', 'mensajes')} en ${plural(seconds, 'segundo', 'segundos')}.`
        : `Borré ${plural(n, 'mensaje', 'mensajes')}.`,
    nothing: 'Nada coincidió, así que no se borró nada.',
    badFilter: (token: string) =>
      `No conozco el filtro ${code(token)}. Usa un miembro, ${code('bots')}, ${code('links')} o ${code('contains <texto>')}.`,
    confirm: (n: number, channel: string) =>
      `> [!WARNING]\n> Esto borra hasta **${count(n)}** mensajes en ${channel}.`,
    confirmHint: (icon: string) => `Reacciona con ${icon} en 30 segundos para continuar.`,
    expired: 'Sin respuesta, así que no pasó nada.',
    summary: (n: number, channel: string) =>
      `Borrados ${plural(n, 'mensaje', 'mensajes')} en ${channel}`,
  },

  massban: {
    none: 'Indica al menos un miembro por ID o mención.',
    tooMany: (max: number) => `Son más de ${count(max)} miembros. Divide la lista.`,
    confirm: (n: number) => `> [!WARNING]\n> Esto banea a **${plural(n, 'miembro', 'miembros')}**.`,
    reason: (reason: string) => `Motivo: ${reason}`,
    confirmHint: (icon: string) => `Reacciona con ${icon} en 30 segundos para continuar.`,
    expired: 'Sin respuesta, así que no se baneó a nadie.',
    progress: (done: number, total: number) => `Revisados ${count(done)} de ${count(total)}.`,
    done: (banned: number, total: number) =>
      `Baneados ${count(banned)} de ${plural(total, 'miembro', 'miembros')}.`,
    cases: (first: number, last: number) =>
      first === last ? `Caso #${first}.` : `Casos #${first} a #${last}.`,
    skipped: (n: number) =>
      `Omitidos ${count(n)}: ya baneados, con rango demasiado alto o fuera de mi alcance.`,
    failed: (n: number) => `${count(n)} fallaron. Revisa mi rol y mis permisos.`,
    casesField: 'Casos',
    logTitle: 'Baneo masivo',
    logSummary: (banned: number, total: number) =>
      `Baneados ${count(banned)} de ${plural(total, 'miembro', 'miembros')}.`,
  },

  lock: {
    locked: (channel: string) => `${channel} está bloqueado.`,
    lockedUntil: (channel: string, when: string) => `${channel} está bloqueado hasta ${when}.`,
    already: (channel: string) => `${channel} ya está bloqueado.`,
    unlocked: (channel: string) => `${channel} vuelve a estar abierto.`,
    notLocked: (channel: string) => `${channel} no está bloqueado.`,
  },

  slowmode: {
    set: (channel: string, delay: string) => `El modo lento en ${channel} ahora es de ${delay}.`,
    off: (channel: string) => `El modo lento en ${channel} está desactivado.`,
    range: 'El modo lento puede ser de hasta 6 horas.',
    bad: `No conozco ese intervalo. Prueba ${code('10s')}, ${code('1m')} o ${code('off')}.`,
  },

  logTitles: {
    lock: 'Canal bloqueado',
    unlock: 'Canal desbloqueado',
    slowmode: 'Modo lento cambiado',
    purge: 'Mensajes borrados',
  },
};

export default es;
