import { code } from '../../ui/format.js';
import type { GeneralCopy } from './copy.js';

const de: GeneralCopy = {
  commands: {
    ping: 'Prüft, ob ich wach bin und wie schnell ich antworte.',
    help: 'Zeigt, was ich kann, oder erklärt ein Modul oder einen Befehl.',
    prefix: 'Zeigt das Prefix oder ändert es für diese Community.',
    about: 'Wer ich bin und wie es mir geht.',
    entropy: 'Wie ordentlich es hier ist.',
    vote: 'Stimm auf fluxerlist für Maxwell ab und schalte alle gesperrten Module für dich frei.',
    mydata: 'Schickt dir alles, was Maxwell in dieser Community über dich speichert.',
    forgetme: 'Löscht deine Levels, Währung, Karten und andere Daten in dieser Community.',
    afk: 'Meldet dich ab. Wer dich erwähnt, sieht deine Notiz, bis du wieder schreibst.',
  },
  ping: {
    first: 'Pong.',
    measuring: 'wird gemessen',
    result: (gateway: string, api: string) => `Pong. Gateway **${gateway}**, API **${api}**.`,
  },
  help: {
    nothing: (query: string, prefix: string) =>
      `Zu ${code(query)} gibt es nichts. ${code(`${prefix}help`)} zeigt alles.`,
    examples: 'Beispiele',
    needs: 'Braucht',
    also: 'Auch',
    title: 'Befehle',
    prefix: (prefix: string) => `Das Prefix hier ist ${code(prefix)}.`,
    details: (prefix: string) => `${prefix}help <modul> oder ${prefix}help <befehl> für Details`,
  },
  prefix: {
    current: (prefix: string) => `Das Prefix hier ist ${code(prefix)}.`,
    change: (prefix: string) => `Ändern mit ${prefix}prefix <neu>.`,
    tooLong: 'Höchstens 8 Zeichen.',
    reset: (prefix: string) => `Wieder ${code(prefix)}.`,
    set: (prefix: string) => `Hier höre ich jetzt auf ${code(prefix)}.`,
  },
  about: {
    tagline: 'Ich halte hier Ordnung.',
    communities: 'Communities',
    online: 'Online seit',
    memory: 'Speicher',
  },
  entropy: 'Entropie hier: niedrig. Soll so bleiben.',
  vote: {
    done: 'Deine Stimme ist da. Gesperrte Module sind für dich im Dashboard offen.',
    ask: (link: string) =>
      `Stimm einmal auf fluxerlist für Maxwell ab, dann sind alle gesperrten Module für dich offen.${link}`,
    again: (prefix: string) => `Danach ${code(`${prefix}vote`)} noch mal ausführen.`,
  },
  greet: {
    hello: 'Hallo, ich bin Maxwell. Ich halte hier Ordnung.',
    prefix: (prefix: string) =>
      `Das Prefix ist ${code(prefix)}. Fang mit ${code(`${prefix}help`)} an.`,
    mention: 'Erwähn mich einfach, wenn du das Prefix vergisst.',
    missing: (permission: string, feature: string) =>
      `> Mir fehlt **${permission}**. Bis dahin geht noch nicht: ${feature}.`,
    features: {
      ManageGuild: 'Einladungs-Tracking',
      EmbedLinks: 'alles außer reinem Text',
      AddReactions: 'Reaktionen',
    },
  },
  afk: {
    set: (reason: string) => (reason ? `Du bist weg: ${reason}` : 'Du bist weg.'),
    back: (duration: string) => `Willkommen zurück. Du warst ${duration} weg.`,
    away: (who: string, reason: string, since: string) =>
      reason ? `${who} ist seit ${since} weg: ${reason}` : `${who} ist seit ${since} weg.`,
  },
  privacy: {
    exported: 'Alles, was ich in dieser Community über dich speichere.',
    nothingStored: 'Ich speichere in dieser Community nichts über dich.',
    noDm: 'Ich kann dir keine DM schicken. Öffne deine DMs und versuch es noch mal.',
    sent: 'Ist in deinen DMs.',
    warning:
      'Das löscht deine Levels, Währung, Karten, Notizen und alles andere, was ich hier über dich speichere. Moderationsfälle bleiben.',
    confirm: (prefix: string) => `Mit ${code(`${prefix}forgetme confirm`)} geht es los.`,
    partial: (modules: string) =>
      `Das meiste ist weg. Bei ${modules} hat es nicht geklappt, versuch es später noch mal.`,
    forgotten: 'Vergessen.',
  },
};

export default de;
