import { mention } from '../../commands/mentions.js';
import { bold, code, count, lines, orList, subtext, timestamp } from '../../ui/format.js';
import type { FormsCopy } from './copy.js';

const de: FormsCopy = {
  commands: {
    form: 'Bewerbungen und andere Formulare.',
    start: 'Füllt ein Formular aus, Frage für Frage per DM.',
    list: 'Zeigt die Formulare, die du hier ausfüllen kannst.',
  },
  listTitle: 'Formulare',
  listEmpty: 'Hier gibt es noch keine Formulare.',
  listLine: (name: string, id: string, questions: number) =>
    `${bold(name)} ${code(id)}  ${count(questions)} ${questions === 1 ? 'Frage' : 'Fragen'}`,
  listHint: (prefix: string) => `Starten mit ${code(`${prefix}form start <name>`)}.`,
  pickForm: (prefix: string) => `Welches? ${code(`${prefix}form list`)} zeigt sie.`,
  unknownForm: (names: string[]) =>
    names.length
      ? `Ein Formular mit dem Namen gibt es nicht. Versuch ${names.map((name) => code(name)).join(', ')}.`
      : 'Hier gibt es noch keine Formulare.',
  closed: (name: string) => `${bold(name)} nimmt gerade keine Antworten an.`,
  needsRole: (roleIds: string[]) =>
    `Für dieses Formular brauchst du ${orList(roleIds.map((id) => mention.role(id)))}.`,
  alreadyFilling: (name: string) =>
    `Du füllst schon ${bold(name)} aus. Mach es fertig oder antworte mit ${code('abbrechen')}.`,
  pending: (name: string) => `Dein ${bold(name)} wird noch geprüft.`,
  once: (name: string) => `Du hast ${bold(name)} schon abgeschickt.`,
  cooldown: (at: Date) => `Du kannst es ${timestamp(at, 'R')} wieder abschicken.`,
  checkDms: 'Schau in deine DMs.',
  continueIn: (channelId: string) => `Weiter geht es in ${mention.channel(channelId)}.`,
  unreachable:
    'Ich kann dir keine DM schicken und konnte keinen Kanal öffnen. Erlaube DMs aus dieser Community und versuch es noch mal.',
  intro: (form: string, guild: string, description: string) =>
    lines(
      `${bold(form)} für ${bold(guild)}`,
      description || null,
      subtext(`Beantworte jede Frage in einer eigenen Nachricht. ${code('abbrechen')} beendet.`),
    ),
  questionHeader: (index: number, total: number) => subtext(`Frage ${index} von ${total}`),
  option: (index: number, text: string) => `${code(String(index))} ${text}`,
  hintChoice: 'Antworte mit der Nummer oder der Option.',
  hintYesNo: 'Antworte mit ja oder nein.',
  hintNumber: (min: number | null, max: number | null) =>
    min !== null && max !== null
      ? `Antworte mit einer Zahl von ${min} bis ${max}.`
      : min !== null
        ? `Antworte mit einer Zahl ab ${min}.`
        : max !== null
          ? `Antworte mit einer Zahl bis ${max}.`
          : 'Antworte mit einer Zahl.',
  hintOptional: `Freiwillig, ${code('überspringen')} lässt sie aus.`,
  problemRequired: 'Hier brauche ich eine Antwort.',
  problemNumber: 'Das ist keine Zahl.',
  problemTooSmall: (min: number) => `Es muss mindestens ${min} sein.`,
  problemTooLarge: (max: number) => `Es darf höchstens ${max} sein.`,
  problemTooShort: (min: number) => `Das ist zu kurz. Mindestens ${count(min)} Zeichen.`,
  problemTooLong: (max: number) => `Das ist zu lang. Höchstens ${count(max)} Zeichen.`,
  problemChoice: 'Such dir eine der Optionen aus, per Nummer oder Name.',
  problemYesNo: 'Antworte mit ja oder nein.',
  cancelled: 'Abgebrochen. Es wurde nichts abgeschickt.',
  expired: (form: string) =>
    `Die Zeit für ${bold(form)} ist abgelaufen. Es wurde nichts abgeschickt.`,
  gone: 'Das Formular ist jetzt geschlossen. Es wurde nichts abgeschickt.',
  submitted: 'Abgeschickt. Die Antwort kommt hier an.',
  submittedChannel: 'Abgeschickt. Dieser Kanal schließt sich in einer Minute.',
  reviewHint: (accept: string, decline: string) =>
    `Reagier mit ${accept} zum Annehmen oder mit ${decline} zum Ablehnen.`,
  reviewVotes: (accept: number, decline: number) =>
    `${count(accept)} dafür, ${count(decline)} dagegen`,
  reviewFooter: (number: number, userId: string) => `Einsendung ${number} / Nutzer ${userId}`,
  statusAccepted: (by: string | null) =>
    by ? `**Angenommen** von ${mention.user(by)}` : '**Angenommen** per Abstimmung',
  statusDeclined: (by: string | null) =>
    by ? `**Abgelehnt** von ${mention.user(by)}` : '**Abgelehnt** per Abstimmung',
  statusNote: (text: string) => `**Notiz** ${text}`,
  dmAccepted: (form: string, guild: string) =>
    `Dein ${bold(form)} für ${bold(guild)} wurde angenommen.`,
  dmDeclined: (form: string, guild: string) =>
    `Dein ${bold(form)} für ${bold(guild)} wurde abgelehnt.`,
  ticketIntro: (form: string, userId: string) => `${bold(form)} von ${mention.user(userId)}`,
  skipped: 'Übersprungen',
  yes: 'Ja',
  no: 'Nein',
};

export default de;
