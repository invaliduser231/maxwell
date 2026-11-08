import { count, plural } from '../../ui/format.js';
import type { InboxCopy } from './inbox-copy.js';

const es: InboxCopy = {
  command:
    'Envía un mensaje o un miembro a los moderadores. Responde al mensaje o nombra al miembro.',
  sent: 'Enviado a los moderadores.',
  already: 'Ya reportaste eso.',
  nothing: 'Responde al mensaje que quieres reportar o nombra al miembro.',
  self: 'No puedes reportarte a ti.',
  bot: 'Los bots no se reportan, pregúntale a alguien de moderación.',
  off: 'Los reportes están desactivados aquí.',
  reactionSent: (server: string) => `Tu reporte en **${server}** llegó a los moderadores.`,
  titles: {
    report: (n: number) => `Reporte #${n}`,
    appeal: (n: number) => `Apelación #${n}`,
    review: (n: number) => `Revisión #${n}`,
    gate: (n: number) => `Entrada #${n}`,
    check: (n: number) => `Verificación #${n}`,
  },
  fields: {
    member: 'Miembro',
    reporters: 'Reportado por',
    message: 'Mensaje',
    report: 'Reporte',
    appeal: 'Apelación',
    review: 'Motivo',
    gate: 'En espera',
    check: 'Verificación',
    status: 'Estado',
    outcome: 'Resultado',
    note: 'Nota',
  },
  reporters: (n: number) => plural(n, 'miembro', 'miembros'),
  jump: 'Ir al mensaje',
  gone: 'Eliminado',
  dashboard: 'Abrir en el panel',
  status: {
    open: 'Abierto',
    claimed: (who: string) => `Tomado por ${who}`,
    resolved: (who: string) => `Resuelto por ${who}`,
    dismissed: (who: string) => `Descartado por ${who}`,
  },
  outcomes: {
    warn: (n: number) => `Advertido, caso #${n}`,
    timeout: (n: number) => `Aislado, caso #${n}`,
    kick: (n: number) => `Expulsado, caso #${n}`,
    ban: (n: number) => `Baneado, caso #${n}`,
    unban: (n: number) => `Baneo retirado, caso #${n}`,
    approved: 'Aprobado',
    declined: 'Rechazado',
    deleted: 'Mensaje eliminado',
    let_in: 'Dejado entrar',
    banned: 'Baneado',
    left: 'Salió del servidor',
    passed: 'Resolvió el captcha',
    released: 'Dejado entrar',
    none: 'Sin acción',
  },
  gateHeld: (n: number) =>
    n === 1 ? '1 miembro espera en la entrada' : `${count(n)} miembros esperan en la entrada`,
  checkStates: {
    undelivered: 'No se pudo enviar el captcha.',
    failed: 'No resolvió el captcha.',
    expired: 'No resolvió el captcha a tiempo.',
  },
  riskScore: (score: number, reasons: string) =>
    `Nivel de riesgo ${score}${reasons ? `: ${reasons}` : ''}`,
  appealAccepted: (server: string) =>
    `Tu apelación en **${server}** fue aceptada. Puedes volver a entrar con una invitación.`,
  appealDeclined: (server: string) => `Tu apelación en **${server}** fue rechazada.`,
  more: (n: number) => `y ${count(n)} más`,
  appealLine: (url: string) => `Puedes apelar aquí: ${url}`,
};

export default es;
