import type { FindingKey, Severity } from '@maxwell/core/modules/security-check';
import { mention } from '../../commands/mentions.js';
import { andList, bold, code, lines, plural, subtext } from '../../ui/format.js';
import type { TargetColor } from './captcha.js';
import type { SecurityCopy } from './copy.js';
import type { RiskReason } from './risk.js';

function span(hours: number): string {
  if (hours % 24 !== 0) return plural(hours, 'hora', 'horas');
  return plural(hours / 24, 'día', 'días');
}

const permissionNames: Record<string, string> = {
  Administrator: 'Administrador',
  ManageGuild: 'Gestionar comunidad',
  ManageRoles: 'Gestionar roles',
  ManageChannels: 'Gestionar canales',
  ManageWebhooks: 'Gestionar webhooks',
  BanMembers: 'Banear miembros',
  KickMembers: 'Expulsar miembros',
  MentionEveryone: 'Mencionar @everyone',
};

const ruleNames: Record<string, string> = {
  spam: 'spam',
  mentions: 'menciones masivas',
  newAccountLinks: 'enlaces de cuentas nuevas',
  invites: 'enlaces de invitación',
};

const named = (names: readonly string[], table: Record<string, string>) =>
  andList(names.map((name) => table[name] ?? name));

const es: SecurityCopy = {
  colors: { blue: 'azul', yellow: 'amarillo' } as Record<TargetColor, string>,
  reason: (reason: RiskReason): string => {
    switch (reason.key) {
      case 'age':
        return `cuenta con menos de ${span(reason.hours)}`;
      case 'noAvatar':
        return 'sin foto de perfil';
      case 'noName':
        return 'sin nombre visible ni apodo';
      case 'newWithoutAvatar':
        return 'cuenta nueva sin foto';
      case 'randomName':
        return 'el nombre parece generado';
      case 'digitName':
        return 'número largo en el nombre';
      case 'spamName':
        return `el nombre contiene "${reason.word}"`;
      case 'wave':
        return `entró junto con ${plural(reason.size - 1, 'cuenta similar', 'cuentas similares')}`;
      case 'rejoin':
        return `volvió ${plural(reason.minutes, 'minuto', 'minutos')} después de salir`;
      case 'priorKick':
        return `expulsado aquí antes (${reason.count})`;
      case 'priorBan':
        return `baneado aquí antes (${reason.count})`;
      case 'shield':
        return `reportado en ${reason.count} comunidades más`;
      case 'newInviter':
        return 'invitado por un miembro recién llegado';
      case 'established':
        return 'cuenta antigua con foto';
      case 'raid':
        return 'entró durante el modo raid';
    }
  },
  log: {
    title: (name: string) => `Entrada de ${name}`,
    clear: 'Todo en orden.',
    flaggedDm: 'Marcado para revisión. Maxwell envió un captcha por MD.',
    flaggedChannel: (channelId: string) =>
      `Marcado para revisión. Tiene los MD cerrados, así que el captcha fue a ${mention.channel(channelId)}.`,
    flaggedNowhere:
      'Marcado para revisión, pero no había dónde enviar el captcha. Espera en la sala de espera.',
    severe: (action: string) => `Puntuación de riesgo demasiado alta. Maxwell ${action} la cuenta.`,
    user: 'Miembro',
    verification: 'Revisión',
    score: 'Puntuación de riesgo',
    reasons: 'Por qué',
    noReasons: 'Nada fuera de lo normal',
    status: {
      clear: 'Superada',
      pending: 'Esperando el captcha',
      passed: 'Superada con captcha',
      failed: 'Captcha fallido',
      expired: 'No respondió a tiempo',
      left: 'Se fue antes de responder',
      released: 'Admitido por la moderación',
    },
    severeActions: { kick: 'expulsó', ban: 'baneó', none: 'marcó' },
    resolved: (userId: string, status: string) => `${mention.user(userId)}: ${status}`,
    noGate:
      'Security quería retener a alguien, pero no hay rol de sala de espera. Configúralo en la página de Security.',
  },
  dm: {
    title: (guild: string) => `Verificación rápida para ${guild}`,
    intro: (color: string) =>
      lines(
        `Escribe los dígitos en ${bold(color)} de la imagen, de izquierda a derecha.`,
        'Ignora los demás colores.',
      ),
    how: (prefix: string) =>
      subtext(
        `Responde aquí solo con los dígitos o usa ${code(`${prefix}verify 12345`)}. ${code(`${prefix}verify new`)} te da una imagen nueva.`,
      ),
    expires: (until: string) => `El código caduca ${until}.`,
    wrong: (left: number) =>
      left === 1 ? 'Ese no es. Te queda un intento.' : `Ese no es. Te quedan ${left} intentos.`,
    passed: (guild: string) => `Ya estás dentro. Te damos la bienvenida a ${bold(guild)}.`,
    failed: (guild: string) =>
      `Ese era el último intento. ${guild} te deja en la puerta por ahora.`,
    kicked: (guild: string) =>
      `Ese era el último intento, así que te sacaron de ${guild}. Puedes volver a entrar.`,
    expired: (guild: string) =>
      `Se acabó el tiempo para ${guild}. Pide a la moderación que te deje entrar.`,
    expiredKick: (guild: string) =>
      `Se acabó el tiempo, así que te sacaron de ${guild}. Puedes volver a entrar.`,
    nothing: 'No tienes ninguna verificación pendiente.',
    which: (guilds: string) =>
      `Tienes verificaciones pendientes en ${guilds}. Responde primero a la más reciente.`,
    fresh: 'Aquí tienes una imagen nueva.',
  },
  channel: {
    intro: (userId: string, color: string, prefix: string) =>
      lines(
        `${mention.user(userId)}, tienes los MD cerrados, así que la verificación es aquí.`,
        `Escribe los dígitos en ${bold(color)} de la imagen con ${code(`${prefix}verify 12345`)}.`,
      ),
  },
  raid: {
    started: {
      joins: (joins: number, seconds: number) =>
        `Modo raid activado. Entraron ${plural(joins, 'cuenta', 'cuentas')} en ${seconds} segundos.`,
      wave: (size: number) =>
        `Modo raid activado. Entraron juntas ${plural(size, 'cuenta nueva similar', 'cuentas nuevas similares')}.`,
      flood: (members: number) =>
        `Modo raid activado. ${plural(members, 'miembro nuevo publicó', 'miembros nuevos publicaron')} lo mismo a la vez.`,
      manual: (userId: string | null) =>
        userId ? `Modo raid activado por ${mention.user(userId)}.` : 'Modo raid activado.',
      nuke: 'Modo raid activado tras un intento de nuke.',
    },
    effects: (until: string, paused: boolean, slowmode: number) =>
      subtext(
        `${andList(
          [
            'cada miembro nuevo recibe un captcha',
            paused ? 'las invitaciones están en pausa' : '',
            slowmode > 0 ? `el modo lento es de ${slowmode} s` : '',
          ].filter(Boolean),
        )}. Termina ${until} salvo que siga habiendo movimiento.`,
      ),
    ended: (checked: number) =>
      `Modo raid desactivado. Mientras tanto, ${plural(checked, 'miembro pasó', 'miembros pasaron')} la verificación.`,
    calmed: (userId: string) => `Modo raid desactivado por ${mention.user(userId)}.`,
    already: 'El modo raid ya está activado.',
    notActive: 'El modo raid no está activado.',
    extended: (until: string) => `El modo raid sigue activado hasta ${until}.`,
  },
  nuke: {
    title: 'Intento de nuke detenido',
    what: {
      channelDelete: 'borró canales',
      channelCreate: 'creó canales',
      roleDelete: 'borró roles',
      ban: 'baneó miembros',
      kick: 'expulsó miembros',
      webhook: 'creó webhooks',
      botAdd: 'añadió bots',
      dangerousGrant: 'repartió permisos peligrosos',
    } as Record<string, string>,
    line: (actorId: string, what: string, count: number, seconds: number) =>
      `${mention.user(actorId)} ${what} ${count} veces en ${seconds} segundos.`,
    stripped: (roles: number) =>
      `Le quité ${plural(roles, 'rol', 'roles')} con permisos peligrosos.`,
    kicked: 'Expulsé la cuenta.',
    banned: 'Baneé la cuenta.',
    failed: 'Maxwell no pudo detener la cuenta. Seguramente su rol está por encima del de Maxwell.',
    restoring: (channels: number, roles: number) =>
      `Restaurando ${plural(channels, 'canal', 'canales')} y ${plural(roles, 'rol', 'roles')} desde la última copia de seguridad.`,
    noBackup:
      'Ninguna copia de seguridad tiene estos canales o roles, así que no se restauró nada.',
  },
  honeypot: {
    warning: lines(
      'No escribas en este canal.',
      'Es una trampa para bots de spam. Cualquier cuenta que publique aquí se elimina al instante.',
    ),
    topic: 'No publiques aquí. Trampa de spam.',
    caught: (userId: string, channelId: string, action: string) =>
      `${mention.user(userId)} publicó en ${mention.channel(channelId)}. Maxwell ${action} la cuenta.`,
    caughtRole: (userId: string, action: string) =>
      `${mention.user(userId)} tomó el rol trampa. Maxwell ${action} la cuenta.`,
    actions: {
      ban: 'baneó',
      softban: 'expulsó y limpió los mensajes de',
      quarantine: 'retuvo',
    },
  },
  incident: {
    kinds: {
      raid: 'Raid',
      manual: 'Raid',
      nuke: 'Nuke',
      lockdown: 'Cierre',
    } as Record<string, string>,
    ended: (kind: string, minutes: number) =>
      `${kind} terminado después de ${plural(minutes, 'minuto', 'minutos')}.`,
    parts: {
      joins: (n: number) => plural(n, 'entrada', 'entradas'),
      bans: (n: number) => plural(n, 'baneo', 'baneos'),
      kicks: (n: number) => plural(n, 'expulsión', 'expulsiones'),
      timeouts: (n: number) => plural(n, 'aislamiento', 'aislamientos'),
      deleted: (n: number) => plural(n, 'mensaje borrado', 'mensajes borrados'),
      hits: (n: number) => plural(n, 'detección de AutoMod', 'detecciones de AutoMod'),
      channels: (n: number) => plural(n, 'cambio de canal', 'cambios de canal'),
      roles: (n: number) => plural(n, 'cambio de rol', 'cambios de rol'),
    },
    quiet: 'No pasó nada más.',
    replay: (url: string) => `[Repetir y deshacer](${url})`,
  },
  status: {
    title: 'Security',
    verification: (on: boolean, threshold: number) =>
      on ? `Captcha desde puntuación de riesgo ${threshold}` : 'Captcha desactivado',
    raid: (on: boolean, active: string | null) =>
      active
        ? `Modo raid activado hasta ${active}`
        : on
          ? 'Vigilancia de raids activada'
          : 'Vigilancia de raids desactivada',
    nuke: (on: boolean): string =>
      on ? 'Vigilancia de nukes activada' : 'Vigilancia de nukes desactivada',
    honeypot: (on: boolean, channels: number) =>
      on ? `${plural(channels, 'canal trampa', 'canales trampa')}` : 'Sin trampa',
    pending: (count: number) => `${plural(count, 'miembro espera', 'miembros esperan')} un captcha`,
  },
  check: {
    title: (score: number) => `Revisión de seguridad: ${score} de 100`,
    clean: 'Nada que arreglar.',
    severity: { high: 'Alta', medium: 'Media', low: 'Baja' } as Record<Severity, string>,
    line: (severity: string, text: string) => `${bold(severity)}: ${text}`,
    more: (count: number) => `${plural(count, 'hallazgo más', 'hallazgos más')} en el panel.`,
    fixHint: (url: string | null) =>
      url
        ? `Arréglalos en la [página de Security](${url}).`
        : 'Arréglalos en la página de Security del panel.',
    findings: {
      securityOff: () => 'Security está desactivado.',
      everyone: (names: readonly string[]) => `@everyone tiene ${named(names, permissionNames)}.`,
      botPosition: (names: readonly string[]) =>
        `El rol de Maxwell está por debajo de ${andList(names.slice(0, 3))}, así que no puede actuar sobre esos miembros.`,
      botAdmin: (names: readonly string[]) =>
        `El rol de bot ${names[0] ?? ''} tiene Administrador.`,
      nukeOff: () => 'La vigilancia de nukes está desactivada.',
      automodOff: () => 'AutoMod está desactivado.',
      automodRules: (names: readonly string[]) => `AutoMod no revisa ${named(names, ruleNames)}.`,
      raidOff: () => 'La vigilancia de raids está desactivada.',
      verificationOff: () => 'El captcha para entradas de riesgo está desactivado.',
      adminRoles: (names: readonly string[]) =>
        `${plural(names.length, 'rol da', 'roles dan')} Administrador: ${andList(names.slice(0, 5))}.`,
      modRoles: (names: readonly string[]) =>
        `No están como roles de moderación en Moderation: ${andList(names.slice(0, 5))}.`,
      securityLog: () => 'Security no tiene canal de registro.',
      modLog: () => 'Moderation no tiene canal de registro.',
    } as Record<FindingKey, (names: readonly string[]) => string>,
  },
  commands: {
    verify: 'Responde a tu captcha. Usa "new" para una imagen nueva.',
    security: 'Muestra qué está vigilando Security.',
    status: 'Muestra qué está vigilando Security.',
    raid: 'Activa el modo raid.',
    calm: 'Desactiva el modo raid.',
    pass: 'Deja pasar a un miembro sin la verificación.',
    honeypot: 'Crea un canal trampa para bots de spam.',
    shield: 'Comparte un baneo con Maxwell Shield durante 90 días.',
    unshield: 'Saca a un miembro de Maxwell Shield.',
    check: 'Evalúa qué tan protegida está la comunidad.',
  },
  replies: {
    passed: (userId: string) => `${mention.user(userId)} ya pasó.`,
    notPending: (userId: string) => `${mention.user(userId)} no está esperando una verificación.`,
    honeypotMade: (channelId: string) => `Trampa puesta en ${mention.channel(channelId)}.`,
    shieldOff: 'Maxwell Shield está desactivado aquí. Se puede activar en el panel, en Security.',
    notBanned: (userId: string) => `${mention.user(userId)} no está baneado aquí.`,
    shared: (userId: string) =>
      `${mention.user(userId)} está compartido con Maxwell Shield durante 90 días.`,
    unshared: (userId: string) => `${mention.user(userId)} ya no está en Maxwell Shield.`,
    notShared: (userId: string) => `${mention.user(userId)} no se compartió desde aquí.`,
  },
};

export default es;
