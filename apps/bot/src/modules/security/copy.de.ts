import { mention } from '../../commands/mentions.js';
import { andList, bold, code, lines, plural, subtext } from '../../ui/format.js';
import type { TargetColor } from './captcha.js';
import type { SecurityCopy } from './copy.js';
import type { RiskReason } from './risk.js';

function span(hours: number): string {
  if (hours % 24 !== 0) return plural(hours, 'Stunde', 'Stunden');
  return plural(hours / 24, 'Tag', 'Tagen');
}

const de: SecurityCopy = {
  colors: { blue: 'blauen', yellow: 'gelben' } as Record<TargetColor, string>,
  reason: (reason: RiskReason): string => {
    switch (reason.key) {
      case 'age':
        return `Konto jünger als ${span(reason.hours)}`;
      case 'noAvatar':
        return 'kein Profilbild';
      case 'noName':
        return 'kein Anzeigename und kein Nickname';
      case 'newWithoutAvatar':
        return 'neues Konto ohne Bild';
      case 'randomName':
        return 'Name wirkt generiert';
      case 'digitName':
        return 'lange Zahl im Namen';
      case 'spamName':
        return `Name enthält "${reason.word}"`;
      case 'wave':
        return `kam zusammen mit ${plural(reason.size - 1, 'ähnlichen Konto', 'ähnlichen Konten')}`;
      case 'rejoin':
        return `${plural(reason.minutes, 'Minute', 'Minuten')} nach dem Austritt zurück`;
      case 'priorKick':
        return `hier schon gekickt (${reason.count})`;
      case 'priorBan':
        return `hier schon gebannt (${reason.count})`;
      case 'newInviter':
        return 'von einem ganz neuen Mitglied eingeladen';
      case 'established':
        return 'altes Konto mit Bild';
      case 'raid':
        return 'kam während des Raid-Modus';
    }
  },
  log: {
    title: (name: string) => `Willkommen ${name}`,
    clear: 'Alles gut.',
    flaggedDm: 'Zur Prüfung markiert. Maxwell hat ein Captcha per DM geschickt.',
    flaggedChannel: (channelId: string) =>
      `Zur Prüfung markiert. DMs sind zu, deshalb ging das Captcha nach ${mention.channel(channelId)}.`,
    flaggedNowhere: 'Zur Prüfung markiert, aber das Captcha konnte nirgends hin. Wartet am Gate.',
    severe: (action: string) => `Risikowert zu hoch. Maxwell hat das Konto ${action}.`,
    user: 'Mitglied',
    verification: 'Prüfung',
    score: 'Risikowert',
    reasons: 'Warum',
    noReasons: 'Nichts Auffälliges',
    status: {
      clear: 'Bestanden',
      pending: 'Wartet auf Captcha',
      passed: 'Bestanden nach Captcha',
      failed: 'Captcha nicht geschafft',
      expired: 'Nicht rechtzeitig geantwortet',
      left: 'Vor der Antwort gegangen',
      released: 'Von einem Mod reingelassen',
    },
    severeActions: { kick: 'gekickt', ban: 'gebannt', none: 'markiert' },
    resolved: (userId: string, status: string) => `${mention.user(userId)}: ${status}`,
    noGate:
      'Security wollte jemanden zurückhalten, aber es gibt keine Gate-Rolle. Richte sie auf der Security-Seite ein.',
  },
  dm: {
    title: (guild: string) => `Kurze Prüfung für ${guild}`,
    intro: (color: string) =>
      lines(
        `Tippe die ${bold(color)} Ziffern aus dem Bild ab, von links nach rechts.`,
        'Alle anderen Farben ignorierst du.',
      ),
    how: (prefix: string) =>
      subtext(
        `Antworte hier nur mit den Ziffern oder nutze ${code(`${prefix}verify 12345`)}. Mit ${code(`${prefix}verify new`)} kommt ein neues Bild.`,
      ),
    expires: (until: string) => `Der Code läuft ${until} ab.`,
    wrong: (left: number) =>
      left === 1 ? 'Stimmt nicht. Noch ein Versuch.' : `Stimmt nicht. Noch ${left} Versuche.`,
    passed: (guild: string) => `Du bist drin. Willkommen auf ${bold(guild)}.`,
    failed: (guild: string) =>
      `Das war der letzte Versuch. ${guild} lässt dich vorerst nicht rein.`,
    kicked: (guild: string) =>
      `Das war der letzte Versuch, deshalb wurdest du aus ${guild} entfernt. Du kannst wieder beitreten.`,
    expired: (guild: string) =>
      `Die Zeit für ${guild} ist abgelaufen. Frag einen Mod, ob er dich reinlässt.`,
    expiredKick: (guild: string) =>
      `Die Zeit ist abgelaufen, deshalb wurdest du aus ${guild} entfernt. Du kannst wieder beitreten.`,
    nothing: 'Bei dir wartet keine Prüfung.',
    which: (guilds: string) => `Prüfungen warten in ${guilds}. Antworte zuerst auf die neueste.`,
    fresh: 'Hier ist ein neues Bild.',
  },
  channel: {
    intro: (userId: string, color: string, prefix: string) =>
      lines(
        `${mention.user(userId)}, deine DMs sind zu, deshalb läuft die Prüfung hier.`,
        `Tippe die ${bold(color)} Ziffern aus dem Bild mit ${code(`${prefix}verify 12345`)} ab.`,
      ),
  },
  raid: {
    started: {
      joins: (joins: number, seconds: number) =>
        `Raid-Modus ist an. ${plural(joins, 'Konto', 'Konten')} kamen in ${seconds} Sekunden.`,
      wave: (size: number) =>
        `Raid-Modus ist an. ${plural(size, 'ähnliches neues Konto', 'ähnliche neue Konten')} kamen zusammen.`,
      flood: (members: number) =>
        `Raid-Modus ist an. ${plural(members, 'neues Mitglied', 'neue Mitglieder')} haben gleichzeitig dasselbe gepostet.`,
      manual: (userId: string | null) =>
        userId ? `Raid-Modus ist an, gestartet von ${mention.user(userId)}.` : 'Raid-Modus ist an.',
      nuke: 'Raid-Modus ist an, nach einem Nuke-Versuch.',
    },
    effects: (until: string, paused: boolean, slowmode: number) =>
      subtext(
        `${andList(
          [
            'jedes neue Mitglied bekommt ein Captcha',
            paused ? 'Einladungen sind pausiert' : '',
            slowmode > 0 ? `Slowmode steht auf ${slowmode} s` : '',
          ].filter(Boolean),
        )}. Endet ${until}, wenn es ruhig bleibt.`,
      ),
    ended: (checked: number) =>
      `Raid-Modus ist aus. In der Zeit geprüft: ${plural(checked, 'Mitglied', 'Mitglieder')}.`,
    calmed: (userId: string) => `Raid-Modus ist aus, beendet von ${mention.user(userId)}.`,
    already: 'Der Raid-Modus ist schon an.',
    notActive: 'Der Raid-Modus ist nicht an.',
    extended: (until: string) => `Der Raid-Modus bleibt bis ${until} an.`,
  },
  nuke: {
    title: 'Nuke-Versuch gestoppt',
    what: {
      channelDelete: 'hat Kanäle gelöscht',
      channelCreate: 'hat Kanäle angelegt',
      roleDelete: 'hat Rollen gelöscht',
      ban: 'hat Mitglieder gebannt',
      kick: 'hat Mitglieder gekickt',
      webhook: 'hat Webhooks angelegt',
      botAdd: 'hat Bots hinzugefügt',
      dangerousGrant: 'hat gefährliche Rechte verteilt',
    } as Record<string, string>,
    line: (actorId: string, what: string, count: number, seconds: number) =>
      `${mention.user(actorId)} ${what}, ${count} Mal in ${seconds} Sekunden.`,
    stripped: (roles: number) =>
      `${plural(roles, 'Rolle', 'Rollen')} mit gefährlichen Rechten entzogen.`,
    kicked: 'Konto gekickt.',
    banned: 'Konto gebannt.',
    failed: 'Maxwell konnte das Konto nicht stoppen. Seine Rolle steht vermutlich über Maxwell.',
    restoring: (channels: number, roles: number) =>
      `Stelle ${plural(channels, 'Kanal', 'Kanäle')} und ${plural(roles, 'Rolle', 'Rollen')} aus dem letzten Backup wieder her.`,
    noBackup:
      'Kein Backup enthält diese Kanäle oder Rollen, deshalb wurde nichts wiederhergestellt.',
  },
  honeypot: {
    warning: lines(
      'Schreib nicht in diesen Kanal.',
      'Er ist eine Falle für Spam-Bots. Wer hier etwas postet, fliegt sofort raus.',
    ),
    topic: 'Hier nicht posten. Spam-Falle.',
    caught: (userId: string, channelId: string, action: string) =>
      `${mention.user(userId)} hat in ${mention.channel(channelId)} gepostet. Maxwell hat das Konto ${action}.`,
    caughtRole: (userId: string, action: string) =>
      `${mention.user(userId)} hat sich die Fallen-Rolle genommen. Maxwell hat das Konto ${action}.`,
    actions: {
      ban: 'gebannt',
      softban: 'entfernt und hinterher aufgeräumt',
      quarantine: 'zurückgehalten',
    },
  },
  status: {
    title: 'Security',
    verification: (on: boolean, threshold: number) =>
      on ? `Captcha ab Risikowert ${threshold}` : 'Captcha ist aus',
    raid: (on: boolean, active: string | null) =>
      active ? `Raid-Modus an bis ${active}` : on ? 'Raid-Wache an' : 'Raid-Wache aus',
    nuke: (on: boolean) => (on ? 'Nuke-Wache an' : 'Nuke-Wache aus'),
    honeypot: (on: boolean, channels: number) =>
      on ? `${plural(channels, 'Fallen-Kanal', 'Fallen-Kanäle')}` : 'Kein Honigtopf',
    pending: (count: number) =>
      `${plural(count, 'Mitglied wartet', 'Mitglieder warten')} auf ein Captcha`,
  },
  commands: {
    verify: 'Beantwortet dein Captcha. Mit "new" kommt ein neues Bild.',
    security: 'Zeigt, worauf Security achtet.',
    status: 'Zeigt, worauf Security achtet.',
    raid: 'Schaltet den Raid-Modus ein.',
    calm: 'Schaltet den Raid-Modus aus.',
    pass: 'Lässt ein Mitglied durch die Prüfung.',
    honeypot: 'Legt einen Fallen-Kanal für Spam-Bots an.',
  },
  replies: {
    passed: (userId: string) => `${mention.user(userId)} ist durch.`,
    notPending: (userId: string) => `${mention.user(userId)} wartet auf keine Prüfung.`,
    honeypotMade: (channelId: string) => `Falle steht in ${mention.channel(channelId)}.`,
  },
};

export default de;
