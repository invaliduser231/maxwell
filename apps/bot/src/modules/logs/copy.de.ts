import { count, plural } from '../../ui/format.js';
import type { LogsCopy } from './copy.js';

const de: LogsCopy = {
  titles: {
    messageDelete: 'Nachricht gelöscht',
    messageEdit: 'Nachricht bearbeitet',
    messageBulkDelete: 'Nachrichten gesammelt gelöscht',
    memberJoin: 'Mitglied beigetreten',
    botJoin: 'Bot hinzugefügt',
    memberLeave: 'Mitglied gegangen',
    memberRoles: 'Rollen geändert',
    nickname: 'Nickname geändert',
    timeoutSet: 'Timeout vergeben',
    timeoutCleared: 'Timeout aufgehoben',
    roleCreate: 'Rolle erstellt',
    roleUpdate: 'Rolle geändert',
    roleDelete: 'Rolle gelöscht',
    channelCreate: 'Kanal erstellt',
    channelUpdate: 'Kanal geändert',
    channelDelete: 'Kanal gelöscht',
    threadCreate: 'Thread erstellt',
    threadUpdate: 'Thread geändert',
    threadDelete: 'Thread gelöscht',
    voiceJoin: 'Sprachkanal betreten',
    voiceLeave: 'Sprachkanal verlassen',
    voiceMove: 'Sprachkanal gewechselt',
    inviteCreate: 'Einladung erstellt',
    inviteDelete: 'Einladung gelöscht',
    ban: 'Mitglied gebannt',
    unban: 'Bann aufgehoben',
    kick: 'Mitglied gekickt',
  },

  labels: {
    before: 'Vorher',
    after: 'Nachher',
    added: 'Hinzugefügt',
    removed: 'Entfernt',
    name: 'Name',
    color: 'Farbe',
    permissions: 'Rechte',
    category: 'Kategorie',
    parent: 'In',
    type: 'Art',
    accountCreated: 'Konto erstellt',
    channel: 'Kanal',
    inviter: 'Erstellt von',
    until: 'Bis',
    attachments: 'Anhänge',
    hoist: 'Getrennt angezeigt',
    mentionable: 'Erwähnbar',
    by: 'Von',
    reason: 'Grund',
  },

  inChannel: (channel: string, sent: string | null) =>
    sent ? `in ${channel}, gesendet ${sent}` : `in ${channel}`,
  unknownContent: 'Der Text war nicht in meinem Cache.',
  emptyContent: 'Kein Text.',
  noNickname: '*kein Nickname*',
  noCategory: '*keine Kategorie*',
  youngAccount: (age: string) => `Das Konto ist erst ${age} alt.`,
  age: (ms: number) => {
    const hours = Math.floor(ms / 3_600_000);
    if (hours < 1) return plural(Math.max(Math.floor(ms / 60_000), 1), 'Minute', 'Minuten');
    if (hours < 48) return plural(hours, 'Stunde', 'Stunden');
    return plural(Math.floor(hours / 24), 'Tag', 'Tage');
  },
  bulkSummary: (n: number, channel: string) =>
    `**${count(n)}** ${n === 1 ? 'Nachricht' : 'Nachrichten'} in ${channel}`,
  bulkCached: (known: number, total: number) =>
    known === 0
      ? 'Keine davon war in meinem Cache.'
      : known === total
        ? 'Der Text aller Nachrichten hängt an.'
        : `Der Text von ${count(known)} davon hängt an.`,
  bulkFile: 'geloeschte-nachrichten.txt',
  bulkUnknownAuthor: 'unbekannt',
  voiceJoined: (user: string, channel: string) => `${user} ist ${channel} beigetreten.`,
  voiceLeft: (user: string, channel: string) => `${user} hat ${channel} verlassen.`,
  voiceMoved: (user: string, from: string, to: string) =>
    `${user} ist von ${from} nach ${to} gewechselt.`,
  inviteLine: (code: string, channel: string | null) =>
    channel ? `\`${code}\` für ${channel}` : `\`${code}\``,
  memberCount: (n: number) => `Mitglied Nr. ${count(n)}`,
  userFooter: (id: string) => `Nutzer ${id}`,
  messageFooter: (userId: string | null, messageId: string) =>
    userId ? `Nutzer ${userId} / Nachricht ${messageId}` : `Nachricht ${messageId}`,
  roleFooter: (id: string) => `Rolle ${id}`,
  channelFooter: (id: string) => `Kanal ${id}`,
  timeoutUntil: (when: string, relative: string) => `${when} (${relative})`,
  change: (label: string, before: string, after: string) => `**${label}** ${before} zu ${after}`,
  permissionsChanged: 'Geändert',
  more: (n: number) => `und ${count(n)} weitere`,
  testNote: 'Das ist ein Testeintrag. Echte Einträge sehen so aus.',

  channelTypes: {
    0: 'Text',
    2: 'Sprache',
    4: 'Kategorie',
    5: 'Ankündigungen',
    10: 'Ankündigungs-Thread',
    11: 'Thread',
    12: 'Privater Thread',
    15: 'Forum',
    16: 'Medien',
  } as Record<number, string>,
};

export default de;
