import type { CaseAction, EscalationAction } from '@maxwell/core/modules/moderation';
import { code, count, plural } from '../../ui/format.js';
import type { ModerationCopy } from './copy.js';
import { humanDuration } from './text.js';

const escalationNouns: Record<EscalationAction, string> = {
  timeout: 'Ein Timeout',
  kick: 'Ein Kick',
  ban: 'Ein Bann',
};

const suggestionNouns: Record<EscalationAction, string> = {
  timeout: 'Timeout',
  kick: 'Kick',
  ban: 'Bann',
};

const de: ModerationCopy = {
  commands: {
    ban: 'Bannt ein Mitglied, dauerhaft oder auf Zeit.',
    unban: 'Hebt einen Bann auf.',
    kick: 'Wirft ein Mitglied raus. Mit einer Einladung kann es wiederkommen.',
    timeout: 'Schaltet ein Mitglied eine Weile stumm. Lesen geht, schreiben nicht.',
    untimeout: 'Beendet einen Timeout vorzeitig.',
    warn: 'Verwarnt ein Mitglied. Verwarnungen zählen für die Eskalationsstufen.',
    caseVoid: 'Erklärt einen Fall für ungültig. Er zählt dann nicht mehr für die Eskalation.',
    case: 'Zeigt einen Fall.',
    cases: 'Zeigt die letzten Fälle oder die Akte eines Mitglieds.',
    reason: 'Setzt oder ändert den Grund eines Falls.',
    warningsClear: 'Nimmt alle aktiven Verwarnungen eines Mitglieds zurück.',
    warnings: 'Zeigt die aktiven Verwarnungen eines Mitglieds.',
    lock: 'Sperrt einen Kanal zum Schreiben. Moderation kann weiter schreiben.',
    unlock: 'Gibt einen gesperrten Kanal wieder frei.',
    slowmode: 'Legt fest, wie lange Mitglieder in einem Kanal zwischen Nachrichten warten.',
    purge: 'Löscht die letzten Nachrichten in diesem Kanal, auf Wunsch gefiltert.',
    massban: 'Bannt mehrere Mitglieder auf einmal per ID oder Erwähnung.',
    noteRemove: 'Löscht eine Notiz.',
    note: 'Legt eine private Notiz zu einem Mitglied an. Notizen sieht nur die Moderation.',
    notes: 'Schickt dir die Notizen zu einem Mitglied per DM.',
  },

  actions: {
    ban: 'Bann',
    unban: 'Bann aufgehoben',
    kick: 'Kick',
    timeout: 'Timeout',
    untimeout: 'Timeout aufgehoben',
    warn: 'Verwarnung',
    flag: 'Prüfung',
  } as Record<CaseAction, string>,

  noReason: 'Kein Grund angegeben',
  maxwell: 'Maxwell',
  unknown: 'Unbekannt',
  permanent: 'Dauerhaft',
  dmTemplate:
    'Du wurdest in **{server}** {action}.\nGrund: {reason}\n-# Fragen gehen an das Team der Community, nicht an mich.',

  done: {
    ban: (who: string, n: number, duration: string | null) =>
      duration
        ? `${who} ist für ${duration} gebannt. Fall #${n}.`
        : `${who} wurde gebannt. Fall #${n}.`,
    unban: (who: string, n: number) => `Der Bann von ${who} ist aufgehoben. Fall #${n}.`,
    kick: (who: string, n: number) => `${who} wurde gekickt. Fall #${n}.`,
    timeout: (who: string, n: number, duration: string) =>
      `${who} hat für ${duration} einen Timeout. Fall #${n}.`,
    untimeout: (who: string, n: number) => `${who} kann wieder schreiben. Fall #${n}.`,
    warn: (who: string, n: number, active: number) =>
      `${who} wurde verwarnt (${active}. Verwarnung). Fall #${n}.`,
  },

  addReason: (prefix: string, n: number) =>
    `Kein Grund angegeben. Mit ${prefix}reason ${n} <Text> trägst du einen nach.`,
  dmFailed: 'Die Person nimmt keine DMs an und hat deshalb nichts mitbekommen.',

  escalated: (
    active: number,
    days: number,
    who: string,
    action: EscalationAction,
    duration: string | null,
    n: number,
  ) => {
    const lead = `${active} Verwarnungen in ${days} Tagen, deshalb`;
    if (action === 'timeout')
      return `${lead} hat ${who} für ${duration} einen Timeout. Fall #${n}.`;
    if (action === 'kick') return `${lead} wurde ${who} gekickt. Fall #${n}.`;
    return duration
      ? `${lead} ist ${who} für ${duration} gebannt. Fall #${n}.`
      : `${lead} wurde ${who} gebannt. Fall #${n}.`;
  },
  escalatedReview: (active: number, days: number, action: EscalationAction, n: number) =>
    `${active} Verwarnungen in ${days} Tagen. ${escalationNouns[action]} wartet im Mod-Log auf Prüfung. Fall #${n}.`,
  escalationFailed: (who: string) =>
    `Gegen ${who} konnte ich nicht eskalieren. Prüf meine Rolle und meine Rechte.`,
  reviewSuggestion: (action: EscalationAction, duration: string | null) =>
    duration
      ? `Vorschlag: ${suggestionNouns[action]} für ${duration}.`
      : `Vorschlag: ${suggestionNouns[action]}.`,
  reviewApproved: (by: string) => `Bestätigt von ${by}.`,
  reviewDeclined: (by: string) => `Abgelehnt von ${by}.`,

  dmAction: {
    warn: () => 'verwarnt',
    timeout: (duration: string) => `für ${duration} stummgeschaltet`,
    kick: () => 'gekickt',
    ban: (duration: string | null) => (duration ? `für ${duration} gebannt` : 'gebannt'),
  },

  errors: {
    reasonRequired: 'Hier brauchst du einen Grund.',
    self: 'Das geht nicht bei dir selbst.',
    me: 'Nicht bei mir.',
    notMember: (who: string) => `${who} ist nicht in dieser Community.`,
    higher: (who: string) => `${who} hat eine Rolle auf oder über deiner.`,
    admin: (who: string) => `${who} ist Admin.`,
    botLower: (who: string) =>
      `Bei ${who} komme ich nicht ran. Meine höchste Rolle muss über der von ${who} liegen.`,
    forbidden: (verb: string, who: string) =>
      `Fluxer hat mich ${who} nicht ${verb} lassen. Prüf meine Rolle und meine Rechte.`,
    notBanned: (who: string) => `${who} ist nicht gebannt.`,
    notTimedOut: (who: string) => `${who} hat keinen Timeout.`,
    timeoutRange: 'Ein Timeout geht höchstens 365 Tage.',
    banRange: 'Ein Bann auf Zeit geht von 1 Minute bis 2 Jahre.',
    noCase: (n: number) => `Es gibt keinen Fall #${n}.`,
    alreadyVoid: (n: number) => `Fall #${n} ist schon ungültig.`,
    noNote: (number: number) => `Es gibt keine Notiz #${number}.`,
    noChannel: 'Diesen Kanal sehe ich nicht.',
  },

  verbs: {
    ban: 'bannen',
    unban: 'entbannen',
    kick: 'kicken',
    timeout: 'stummschalten',
    untimeout: 'wieder freischalten',
  } as Record<string, string>,

  fields: {
    member: 'Mitglied',
    moderator: 'Moderation',
    duration: 'Dauer',
    reason: 'Grund',
    evidence: 'Beweis',
    excerpt: 'Nachricht',
    editedBy: 'Geändert von',
    voided: 'Ungültig',
    channel: 'Kanal',
    ended: 'Beendet',
  },
  caseTitle: (n: number, title: string, voided: boolean) =>
    `Fall ${n}: ${title}${voided ? ' (ungültig)' : ''}`,
  caseFooter: (userId: string | null, n: number) =>
    userId ? `Nutzer ${userId} / Fall ${n}` : `Fall ${n}`,
  channelFooter: (id: string) => `Kanal ${id}`,
  userFooter: (id: string) => `Nutzer ${id}`,
  reasonHint: (prefix: string, n: number) =>
    `Kein Grund angegeben. ${code(`${prefix}reason ${n} <Text>`)} trägt einen nach.`,
  voidedLine: (by: string, when: string, reason: string | null) =>
    reason ? `Von ${by} ${when}. ${reason}` : `Von ${by} ${when}.`,

  risk: {
    newAccount: (ageMs: number) => `Das Konto ist ${humanDuration(ageMs)} alt.`,
    recentJoin: 'In den letzten 24 Stunden beigetreten.',
    names: (n: number) => `Hat den Namen ${count(n)} Mal geändert.`,
    warns: (n: number) => `${plural(n, 'aktive Verwarnung', 'aktive Verwarnungen')}.`,
    banned: (n: number) =>
      n === 1 ? 'Wurde hier schon einmal gebannt.' : `Wurde hier schon ${count(n)} Mal gebannt.`,
  },

  cases: {
    title: 'Fälle',
    titleFor: (name: string) => `Fälle von ${name}`,
    empty: [
      'Noch keine Fälle. Bisher ruhig.',
      'Keine Fälle vorhanden.',
      'Noch nichts in der Akte.',
    ],
    emptyFor: (who: string) => `Keine Fälle für ${who}. Weiße Weste.`,
    by: (who: string) => `von ${who}`,
    summary: (total: number, warns: number, notes: number) =>
      `${plural(total, 'Fall', 'Fälle')}, ${plural(warns, 'aktive Verwarnung', 'aktive Verwarnungen')}, ${plural(notes, 'Notiz', 'Notizen')}`,
    names: 'Frühere Namen',
  },

  warnings: {
    title: (name: string) => `Verwarnungen von ${name}`,
    empty: (who: string) => `Keine aktiven Verwarnungen für ${who}. Weiße Weste.`,
    expires: (when: string) => `läuft ab ${when}`,
    cleared: (n: number, who: string) =>
      `${plural(n, 'Verwarnung', 'Verwarnungen')} von ${who} entfernt.`,
    undoHint: 'Doch nicht? Im Audit-Verlauf kannst du es rückgängig machen.',
  },

  reason: {
    set: (n: number) => `Fall #${n} hat einen neuen Grund.`,
  },
  voided: (n: number) => `Fall #${n} ist ungültig.`,

  notes: {
    added: (who: string) => `Notiz zu ${who} angelegt.`,
    title: (name: string) => `Notizen zu ${name}`,
    empty: (who: string) => `Keine Notizen zu ${who}.`,
    sent: 'Ist in deinen DMs.',
    removed: (number: number) => `Notiz #${number} gelöscht.`,
    line: (number: number, when: string, by: string) => `**#${number}** ${when} ${by}`,
  },

  purge: {
    working: 'Bin dran.',
    progress: (done: number, total: number) => `${count(done)} von ${count(total)} gelöscht.`,
    done: (n: number, seconds: number | null) =>
      seconds !== null && seconds >= 3
        ? `${plural(n, 'Nachricht', 'Nachrichten')} in ${plural(seconds, 'Sekunde', 'Sekunden')} gelöscht.`
        : `${plural(n, 'Nachricht', 'Nachrichten')} gelöscht.`,
    nothing: 'Nichts hat gepasst, also wurde nichts gelöscht.',
    badFilter: (token: string) =>
      `Den Filter ${code(token)} kenne ich nicht. Nimm ein Mitglied, ${code('bots')}, ${code('links')} oder ${code('contains <Text>')}.`,
    confirm: (n: number, channel: string) =>
      `> [!WARNING]\n> Das löscht bis zu **${count(n)}** Nachrichten in ${channel}.`,
    confirmHint: (icon: string) => `Reagiere innerhalb von 30 Sekunden mit ${icon}, um loszulegen.`,
    expired: 'Keine Antwort, also ist nichts passiert.',
    summary: (n: number, channel: string) =>
      `${plural(n, 'Nachricht', 'Nachrichten')} in ${channel} gelöscht`,
  },

  massban: {
    none: 'Nenn mindestens ein Mitglied per ID oder Erwähnung.',
    tooMany: (max: number) => `Das sind mehr als ${count(max)} Mitglieder. Teil die Liste auf.`,
    confirm: (n: number) => `> [!WARNING]\n> Das bannt **${plural(n, 'Mitglied', 'Mitglieder')}**.`,
    reason: (reason: string) => `Grund: ${reason}`,
    confirmHint: (icon: string) => `Reagiere innerhalb von 30 Sekunden mit ${icon}, um loszulegen.`,
    expired: 'Keine Antwort, also wurde niemand gebannt.',
    progress: (done: number, total: number) => `${count(done)} von ${count(total)} geprüft.`,
    done: (banned: number, total: number) =>
      `${count(banned)} von ${plural(total, 'Mitglied', 'Mitgliedern')} gebannt.`,
    cases: (first: number, last: number) =>
      first === last ? `Fall #${first}.` : `Fälle #${first} bis #${last}.`,
    skipped: (n: number) =>
      `${count(n)} übersprungen: schon gebannt, zu hoher Rang oder außer meiner Reichweite.`,
    failed: (n: number) => `${count(n)} fehlgeschlagen. Prüf meine Rolle und Rechte.`,
    casesField: 'Fälle',
    logTitle: 'Massenbann',
    logSummary: (banned: number, total: number) =>
      `${count(banned)} von ${plural(total, 'Mitglied', 'Mitgliedern')} gebannt.`,
  },

  lock: {
    locked: (channel: string) => `${channel} ist gesperrt.`,
    lockedUntil: (channel: string, when: string) => `${channel} ist gesperrt bis ${when}.`,
    already: (channel: string) => `${channel} ist schon gesperrt.`,
    unlocked: (channel: string) => `${channel} ist wieder offen.`,
    notLocked: (channel: string) => `${channel} ist nicht gesperrt.`,
  },

  slowmode: {
    set: (channel: string, delay: string) => `Slowmode in ${channel} steht jetzt auf ${delay}.`,
    off: (channel: string) => `Slowmode in ${channel} ist aus.`,
    range: 'Slowmode geht bis 6 Stunden.',
    bad: `Diese Wartezeit kenne ich nicht. Probier ${code('10s')}, ${code('1m')} oder ${code('off')}.`,
  },

  logTitles: {
    lock: 'Kanal gesperrt',
    unlock: 'Kanal freigegeben',
    slowmode: 'Slowmode geändert',
    purge: 'Nachrichten gelöscht',
  },
};

export default de;
