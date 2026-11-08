import { code } from '../../ui/format.js';
import type { AutomodCopy } from './copy.js';

const es: AutomodCopy = {
  commands: {
    gate: 'La sala de espera del escudo anti-raid.',
    list: 'Quién está esperando en la sala de espera.',
    let: 'Deja entrar a un miembro o a todos los que están en la sala de espera.',
    ban: 'Banea a todos los que esperan en la sala de espera.',
  },
  rules: {
    spam: 'Spam',
    invites: 'Enlaces de invitación',
    links: 'Enlaces',
    mentions: 'Menciones masivas',
    caps: 'Mayúsculas',
    words: 'Lista de palabras',
    repeats: 'Mensajes repetidos',
    emoji: 'Spam de emojis',
    newAccountLinks: 'Enlaces de cuentas nuevas',
    phishing: 'Enlaces de phishing',
  },
  holds: {
    raid: 'raid',
    lockdown: 'cierre',
    account_age: 'cuenta nueva',
    verify: 'captcha',
    honeypot: 'trampa',
  },
  details: {
    spam: (count: number, seconds: number) => `${count} mensajes en ${seconds} s`,
    invite: (code: string) => `invitación ${code}`,
    link: (host: string) => `enlace a ${host}`,
    mentions: (count: number) => `${count} menciones`,
    caps: (percent: number) => `${percent} % mayúsculas`,
    word: (pattern: string) => `coincide con ${pattern}`,
    repeats: (count: number) => `el mismo mensaje ${count} veces`,
    emoji: (count: number) => `${count} emojis`,
    newAccountLink: (age: string) => `enlace de una cuenta con ${age} de antigüedad`,
    phishing: (host: string) => `dominio de phishing conocido ${host}`,
    lookalike: (host: string, brand: string) => `${host} imita a ${brand}`,
  },
  brands: {
    fluxer: 'Fluxer',
    discord: 'Discord',
    steam: 'Steam',
    nitro: 'Nitro',
  },
  actions: {
    delete: 'Mensaje eliminado',
    warn: 'Advertencia',
    timeout: (duration: string) => `Aislamiento de ${duration}`,
    kick: 'Expulsión',
    ban: 'Baneo',
    logOnly: 'Ninguna, solo registro',
  },
  theCommunity: 'la comunidad',
  warn: (who: string, rule: string) =>
    `${who}, ese mensaje incumplió la regla **${rule}** de aquí.`,
  dmTimeout: (guild: string, duration: string, rule: string) =>
    `Te aislaron en **${guild}** durante ${duration}. Motivo: ${rule}.`,
  dmKick: (guild: string, rule: string) => `Te expulsaron de **${guild}**. Motivo: ${rule}.`,
  dmBan: (guild: string, rule: string) => `Te banearon de **${guild}**. Motivo: ${rule}.`,
  dmFooter: 'Las preguntas van al equipo de la comunidad, no a mí.',
  warnReason: (rule: string, detail: string) =>
    detail ? `AutoMod: ${rule}, ${detail}` : `AutoMod: ${rule}`,
  logTitle: (rule: string, logOnly: boolean) =>
    logOnly ? `${rule} (solo registro)` : `${rule} detectado`,
  logWhere: (who: string, channel: string) => `${who} en ${channel}`,
  logAction: 'Acción',
  logFooter: (userId: string, messageId: string) => `Usuario ${userId} / Mensaje ${messageId}`,
  slowmode: {
    raised: (channel: string, duration: string, rate: number) =>
      `Modo lento en ${channel} subido a ${duration}, ${rate} mensajes en el último minuto.`,
    lowered: (channel: string, duration: string) =>
      `Modo lento en ${channel} bajado a ${duration}.`,
    restored: (channel: string, duration: string | null) =>
      duration
        ? `Modo lento en ${channel} de vuelta a ${duration}.`
        : `El modo lento en ${channel} está desactivado otra vez.`,
  },

  raidAlert: (joins: number, seconds: number, until: string) =>
    [
      '> [!CAUTION]',
      `> El escudo anti-raid está activo. **${joins}** entradas en ${seconds} segundos.`,
      `Quienes entren esperan en la sala de espera hasta ${until}.`,
    ].join('\n'),
  raidNoGate: 'No hay rol de sala de espera, así que no se retiene a nadie. Elige uno en el panel.',
  gateHint: (prefix: string) => `${code(`${prefix}gate list`)} muestra quién está esperando.`,
  lockdownStarted: (until: string) =>
    `Cierre hasta ${until}. Quienes entren esperan en la sala de espera.`,
  lockdownEnded: (held: number) =>
    held === 0
      ? 'Cierre terminado. No queda nadie en la sala de espera.'
      : `Cierre terminado. **${held}** siguen esperando en la sala de espera.`,

  gateTitle: 'En la sala de espera',
  gateIncident: (held: number, until: string | null) =>
    until ? `**${held}** retenidos. Cierre hasta ${until}.` : `**${held}** retenidos.`,
  gateLine: (who: string, when: string, reason: string) => `${who}  ${when}  *${reason}*`,
  gateEmpty: [
    'Nadie está esperando en la sala de espera.',
    'La sala de espera está vacía.',
    'Nadie en la sala de espera. Día tranquilo.',
  ],
  notHeld: (who: string) => `${who} no está esperando en la sala de espera.`,
  letInOne: (who: string) => `${who} ya puede entrar.`,
  letInAll: (count: number) =>
    count === 1 ? 'Dejé entrar a **1** miembro.' : `Dejé entrar a **${count}** miembros.`,
  letInPartial: (done: number, total: number) =>
    `Dejé entrar a **${done}** de ${total}. Al resto no le pude quitar el rol de sala de espera.`,
  noGateRole: 'No hay rol de sala de espera. Elige uno en el panel.',
  banConfirm: (count: number, ok: string) =>
    [
      '> [!WARNING]',
      `> Esto banea a **${count}** ${count === 1 ? 'miembro retenido' : 'miembros retenidos'} en la sala de espera.`,
      `Reacciona con ${ok} en 30 segundos para continuar.`,
    ].join('\n'),
  banTimeout: 'Sin respuesta, así que no pasó nada.',
  bannedAll: (count: number) =>
    count === 1
      ? 'Baneé a **1** miembro de la sala de espera.'
      : `Baneé a **${count}** miembros de la sala de espera.`,
  bannedPartial: (done: number, total: number) =>
    `Baneé a **${done}** de ${total}. El resto probablemente tiene roles por encima del mío.`,
};

export default es;
