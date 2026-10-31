import { mention } from '../../commands/mentions.js';
import { bold, code, lines, subtext, timestamp } from '../../ui/format.js';
import type { TicketTarget } from './config.js';
import type { TicketsCopy } from './copy.js';
import { padNumber } from './naming.js';

type Kind = TicketTarget['kind'];

const de: TicketsCopy = {
  commands: {
    ticket: 'Private Tickets mit dem Team.',
    open: 'Öffnet ein privates Ticket mit dem Team.',
    close: 'Schließt dieses Ticket und behält ein Transkript.',
    claim: 'Übernimmt dieses Ticket. Noch mal, um es wieder abzugeben.',
    add: 'Lässt ein Mitglied dieses Ticket sehen.',
    remove: 'Nimmt ein Mitglied aus diesem Ticket raus.',
    rename: 'Benennt diesen Ticket-Kanal um.',
    modmail: 'Schickt deine nächste DM an das Team hier.',
  },
  panelDescription: (kind: Kind, emoji: string) =>
    ({
      support: `Brauchst du Hilfe? Reagier mit ${emoji}, um ein Ticket zu öffnen.`,
      report: `Läuft hier etwas schief? Reagier mit ${emoji}. Nur das Team sieht dein Ticket.`,
      appeal: `Soll eine Entscheidung noch mal geprüft werden? Reagier mit ${emoji}, um einen Einspruch zu öffnen.`,
      custom: `Reagier mit ${emoji}, um ein Ticket zu öffnen.`,
      modmail: `Reagier mit ${emoji}, um ein Ticket zu öffnen.`,
    })[kind],
  openDefault: (kind: Kind) =>
    ({
      support: 'Schreib uns, was du brauchst. Das Team meldet sich gleich.',
      report: 'Schreib uns, was passiert ist und wer beteiligt war. Nachrichtenlinks helfen.',
      appeal: 'Schreib uns, welche Entscheidung wir prüfen sollen und warum.',
      custom: 'Das Team meldet sich gleich.',
      modmail: 'Neue Modmail. Nachrichten hier gehen per DM an das Mitglied.',
    })[kind],
  ticketTitle: (name: string, number: number) => `${name} #${padNumber(number)}`,
  ticketTopic: (name: string, number: number, openerId: string) =>
    `${name} #${padNumber(number)} von ${openerId}`,
  closeHint: (emoji: string) => `Reagier mit ${emoji}, um zu schließen.`,
  internalHint: (marker: string) =>
    `Fang eine Nachricht mit ${code(marker)} an, damit sie intern bleibt.`,
  subject: (text: string) => `**Betreff** ${text}`,
  opened: (channelId: string) => `${mention.channel(channelId)} ist offen.`,
  alreadyOpen: (channelId: string | null) =>
    channelId
      ? `Du hast schon ein offenes Ticket: ${mention.channel(channelId)}.`
      : 'Du hast schon ein offenes Ticket.',
  notSetUp:
    'Tickets sind hier noch nicht eingerichtet. Ein Admin kann im Dashboard ein Panel anlegen.',
  openFailed: 'Ich konnte den Ticket-Kanal nicht anlegen. Prüf meine Rechte in der Kategorie.',
  inCommunity: 'in dieser Community',
  theCommunity: 'Die Community',
  communityFallback: 'der Community',
  notTicket: 'Das ist kein offenes Ticket.',
  teamOnly: 'Das kann nur das Ticket-Team.',
  closeNotAllowed: 'Dieses Ticket kann nur das Ticket-Team schließen.',
  closed: (by: string | null) => (by ? `Geschlossen von ${mention.user(by)}.` : 'Geschlossen.'),
  closedIdle: 'Geschlossen, weil sich nichts mehr getan hat.',
  reason: (text: string) => `**Grund** ${text}`,
  goesAway: (at: Date) => subtext(`Dieser Kanal verschwindet ${timestamp(at, 'R')}.`),
  archived: subtext('Der Kanal bleibt als Archiv.'),
  claimed: (userId: string) => `${mention.user(userId)} kümmert sich darum.`,
  unclaimed: 'Gerade kümmert sich niemand darum.',
  added: (userId: string) => `${mention.user(userId)} sieht dieses Ticket jetzt.`,
  removed: (userId: string) => `${mention.user(userId)} sieht dieses Ticket nicht mehr.`,
  alreadyAdded: (userId: string) => `${mention.user(userId)} ist schon drin.`,
  notAdded: (userId: string) => `${mention.user(userId)} wurde nicht zu diesem Ticket hinzugefügt.`,
  keepOpener: 'Wer das Ticket geöffnet hat, bleibt drin.',
  notMember: 'Das ist kein Mitglied hier.',
  renamed: (name: string) => `Umbenannt in ${code(name)}.`,
  badName: 'Der Name geht für einen Kanal nicht. Nimm Buchstaben, Zahlen und Bindestriche.',
  reopened: (by: string | null) =>
    by ? `Wieder geöffnet von ${mention.user(by)}.` : 'Wieder geöffnet.',
  cannedUnknown: (prefix: string, names: string[]) =>
    names.length
      ? `Eine Vorlage mit dem Namen gibt es nicht. Probier ${names.map((name) => code(`${prefix}${name}`)).join(', ')}.`
      : 'Noch keine Vorlagen. Leg welche im Dashboard an.',
  modmailSent: (guild: string) =>
    `Ist beim Team von ${bold(guild)} angekommen. Antworten erscheinen hier.`,
  modmailPick: (entries: { number: number; name: string }[], page: number, pages: number) =>
    lines(
      'Für welche Community ist das? Antworte mit der Nummer oder einem Teil des Namens.',
      ...entries.map((entry) => `${code(String(entry.number))} ${bold(entry.name)}`),
      pages > 1 && subtext(`Seite ${page} von ${pages}. Mit den Pfeilen blätterst du weiter.`),
    ),
  modmailNoMatch: (query: string) =>
    `Zu ${bold(query)} passt keine Community in der Liste. Antworte mit einer Nummer oder einem anderen Teil des Namens.`,
  modmailExpired: 'Die Liste ist nach 5 Minuten abgelaufen. Hier ist eine neue.',
  modmailGone: (guild: string) =>
    `${bold(guild)} kann deine Nachricht gerade nicht annehmen. Such dir eine andere aus.`,
  modmailTryLater:
    'Ich konnte deine Communities gerade nicht prüfen. Versuch es in einer Minute noch mal.',
  modmailReady: (guild: string) => `Schreib mir hier, und es geht an das Team von ${bold(guild)}.`,
  modmailCheckDms: 'Schau in deine DMs.',
  modmailDmsClosed:
    'Ich kann dir keine DM schicken. Erlaub DMs aus dieser Community und versuch es noch mal.',
  modmailOff: 'Modmail ist in dieser Community aus.',
  modmailOpenHere: 'Du hast hier schon eine offene Modmail. Schreib mir einfach per DM.',
  modmailClosed: (guild: string) => `Das Team von ${bold(guild)} hat das Gespräch beendet.`,
  modmailUnreachable: 'Ich komme nicht durch. Die DMs sind zu.',
  modmailUnavailable: (guild: string) => `${bold(guild)} nimmt gerade keine Nachrichten an.`,
  modmailTeam: (guild: string) => `Team von ${guild}`,
  modmailFrom: (guild: string) => `Von ${guild}`,
  ratingPrompt: (number: number, guild: string, reactions: boolean) =>
    lines(
      `Dein Ticket #${padNumber(number)} in ${bold(guild)} ist geschlossen.`,
      reactions
        ? 'Wie lief es? Reagier mit 1 bis 5.'
        : 'Wie lief es? Antworte mit einer Zahl von 1 bis 5.',
    ),
  ratingThanks: (rating: number) => `Danke. ${rating} von 5 notiert.`,
  ratingLog: (number: number, rating: number, userId: string) =>
    `Ticket #${padNumber(number)} hat **${rating} von 5** von ${mention.user(userId)} bekommen.`,
  logOpened: 'Ticket geöffnet',
  logClosed: 'Ticket geschlossen',
  logOpener: (userId: string) => `**Geöffnet von** ${mention.user(userId)}`,
  logClaimed: (userId: string) => `**Übernommen von** ${mention.user(userId)}`,
  logClosedBy: (userId: string | null) =>
    userId ? `**Geschlossen von** ${mention.user(userId)}` : '**Geschlossen von** Maxwell',
  logMessages: (count: string) => `**Nachrichten** ${count}`,
  logDuration: (text: string) => `**Dauer** ${text}`,
  logTranscript: (url: string) => `[Transkript](${url})`,
  logChannel: (channelId: string) => `**Kanal** ${mention.channel(channelId)}`,
  footerTicket: (number: number, userId: string) => `Ticket ${number} / Nutzer ${userId}`,
  footerUser: (userId: string) => `Nutzer ${userId}`,
  fromWeb: 'Über das Webformular gesendet.',
};

export default de;
