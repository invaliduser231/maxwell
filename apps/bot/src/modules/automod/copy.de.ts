import { code } from '../../ui/format.js';
import type { AutomodCopy } from './copy.js';

const de: AutomodCopy = {
  commands: {
    gate: 'Der Wartebereich des Raid-Schutzes.',
    list: 'Wer im Wartebereich wartet.',
    let: 'Lässt ein Mitglied oder alle aus dem Wartebereich rein.',
    ban: 'Bannt alle, die im Wartebereich warten.',
  },
  rules: {
    spam: 'Spam',
    invites: 'Einladungslinks',
    links: 'Links',
    mentions: 'Massen-Erwähnungen',
    caps: 'Großbuchstaben',
    words: 'Wortliste',
    repeats: 'Wiederholte Nachrichten',
    emoji: 'Emoji-Spam',
    newAccountLinks: 'Links von neuen Konten',
    phishing: 'Phishing-Links',
  },
  holds: {
    raid: 'Raid',
    lockdown: 'Lockdown',
    account_age: 'neues Konto',
    verify: 'Captcha',
    honeypot: 'Honigtopf',
  },
  details: {
    spam: (count: number, seconds: number) => `${count} Nachrichten in ${seconds} s`,
    invite: (code: string) => `Einladung ${code}`,
    link: (host: string) => `Link zu ${host}`,
    mentions: (count: number) => `${count} Erwähnungen`,
    caps: (percent: number) => `${percent} % Großbuchstaben`,
    word: (pattern: string) => `Treffer: ${pattern}`,
    repeats: (count: number) => `${count}-mal dieselbe Nachricht`,
    emoji: (count: number) => `${count} Emojis`,
    newAccountLink: (age: string) => `Link von einem Konto, das erst ${age} alt ist`,
    phishing: (host: string) => `bekannte Phishing-Domain ${host}`,
    lookalike: (host: string, brand: string) => `${host} gibt sich als ${brand} aus`,
  },
  brands: {
    fluxer: 'Fluxer',
    discord: 'Discord',
    steam: 'Steam',
    nitro: 'Nitro',
  },
  actions: {
    delete: 'Nachricht gelöscht',
    warn: 'Verwarnt',
    timeout: (duration: string) => `Timeout für ${duration}`,
    kick: 'Gekickt',
    ban: 'Gebannt',
    logOnly: 'Keine, nur geloggt',
  },
  theCommunity: 'der Community',
  warn: (who: string, rule: string) =>
    `${who}, die Nachricht verstößt hier gegen die Regel **${rule}**.`,
  dmTimeout: (guild: string, duration: string, rule: string) =>
    `Du hast in **${guild}** einen Timeout für ${duration} bekommen. Grund: ${rule}.`,
  dmKick: (guild: string, rule: string) => `Du wurdest aus **${guild}** gekickt. Grund: ${rule}.`,
  dmBan: (guild: string, rule: string) => `Du wurdest aus **${guild}** gebannt. Grund: ${rule}.`,
  dmFooter: 'Bei Fragen wende dich an das Team der Community, nicht an mich.',
  warnReason: (rule: string, detail: string) =>
    detail ? `AutoMod: ${rule}, ${detail}` : `AutoMod: ${rule}`,
  logTitle: (rule: string, logOnly: boolean) =>
    logOnly ? `${rule} (nur geloggt)` : `${rule} erwischt`,
  logWhere: (who: string, channel: string) => `${who} in ${channel}`,
  logAction: 'Aktion',
  logFooter: (userId: string, messageId: string) => `Nutzer ${userId} / Nachricht ${messageId}`,
  slowmode: {
    raised: (channel: string, duration: string, rate: number) =>
      `Slowmode in ${channel} auf ${duration} erhöht, ${rate} Nachrichten in der letzten Minute.`,
    lowered: (channel: string, duration: string) =>
      `Slowmode in ${channel} auf ${duration} gesenkt.`,
    restored: (channel: string, duration: string | null) =>
      duration
        ? `Slowmode in ${channel} wieder auf ${duration}.`
        : `Slowmode in ${channel} ist wieder aus.`,
  },

  raidAlert: (joins: number, seconds: number, until: string) =>
    [
      '> [!CAUTION]',
      `> Raid-Schutz ist aktiv. **${joins}** Beitritte in ${seconds} Sekunden.`,
      `Neue Mitglieder warten bis ${until} im Wartebereich.`,
    ].join('\n'),
  raidNoGate:
    'Es ist keine Wartebereich-Rolle gesetzt, deshalb wird niemand festgehalten. Wähl eine im Dashboard.',
  gateHint: (prefix: string) => `${code(`${prefix}gate list`)} zeigt, wer wartet.`,
  lockdownStarted: (until: string) =>
    `Lockdown bis ${until}. Neue Mitglieder warten im Wartebereich.`,
  lockdownEnded: (held: number) =>
    held === 0
      ? 'Lockdown vorbei. Im Wartebereich ist niemand mehr.'
      : `Lockdown vorbei. **${held}** warten noch im Wartebereich.`,

  gateTitle: 'Im Wartebereich',
  gateIncident: (held: number, until: string | null) =>
    until ? `**${held}** festgehalten. Lockdown bis ${until}.` : `**${held}** festgehalten.`,
  gateLine: (who: string, when: string, reason: string) => `${who}  ${when}  *${reason}*`,
  gateEmpty: [
    'Im Wartebereich wartet niemand.',
    'Der Wartebereich ist leer.',
    'Niemand im Wartebereich. Ruhiger Tag.',
  ],
  notHeld: (who: string) => `${who} wartet nicht im Wartebereich.`,
  letInOne: (who: string) => `${who} ist drin.`,
  letInAll: (count: number) =>
    count === 1 ? '**1** Mitglied reingelassen.' : `**${count}** Mitglieder reingelassen.`,
  letInPartial: (done: number, total: number) =>
    `**${done}** von ${total} reingelassen. Beim Rest konnte ich die Wartebereich-Rolle nicht entfernen.`,
  noGateRole: 'Es ist keine Wartebereich-Rolle gesetzt. Wähl eine im Dashboard.',
  banConfirm: (count: number, ok: string) =>
    [
      '> [!WARNING]',
      `> Das bannt **${count}** ${count === 1 ? 'Mitglied' : 'Mitglieder'} aus dem Wartebereich.`,
      `Reagier innerhalb von 30 Sekunden mit ${ok}, um fortzufahren.`,
    ].join('\n'),
  banTimeout: 'Keine Antwort, also ist nichts passiert.',
  bannedAll: (count: number) =>
    count === 1
      ? '**1** Mitglied aus dem Wartebereich gebannt.'
      : `**${count}** Mitglieder aus dem Wartebereich gebannt.`,
  bannedPartial: (done: number, total: number) =>
    `**${done}** von ${total} gebannt. Die übrigen haben vermutlich Rollen über meiner.`,
};

export default de;
