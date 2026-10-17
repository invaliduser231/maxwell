import { mention } from '../../commands/mentions.js';
import { andList, code, count, plural, timestamp } from '../../ui/format.js';
import type { CollectionCopy } from './copy.js';

const de: CollectionCopy = {
  commands: {
    cards: 'Sammle Karten aus deiner Community und aus eigenen Decks.',
    view: 'Deine Sammlung, die von jemand anderem oder eine Karte aus der Nähe.',
    pack: 'Öffnet ein Kartenpack. Nimmt zuerst eins aus dem Shop, sonst zahlst du den Preis.',
    trade: 'Biete jemandem Karten gegen welche von ihm an. Beide müssen zustimmen.',
    wishlist: 'Karten, die du haben willst. Du wirst gepingt, wenn eine droppt.',
    sets: 'Die Sets hier und wie weit du bist.',
    optin: 'Bring deine eigene Karte ins Community-Deck.',
    optout: 'Nimm deine Karte aus dem Community-Deck. Jede Kopie verschwindet.',
    claim: 'Schnapp dir die Karte, die hier gerade gedroppt ist.',
  },
  communityDeck: 'Community',
  unknownMember: 'Dieses Mitglied finde ich nicht.',
  summary: {
    self: (total: number, unique: number) =>
      `Du hast **${plural(total, 'Karte', 'Karten')}**, ${count(unique)} verschiedene.`,
    other: (userId: string, total: number, unique: number) =>
      `${mention.user(userId)} hat **${plural(total, 'Karte', 'Karten')}**, ${count(unique)} verschiedene.`,
    emptySelf: [
      'Noch keine Karten. Warte auf einen Drop oder öffne ein Pack.',
      'Deine Sammlung ist bisher leer.',
    ],
    emptyOther: (userId: string) => `${mention.user(userId)} hat noch keine Karten.`,
    hint: (prefix: string) => `${prefix}cards view zeigt die ganze Liste`,
  },
  view: {
    title: 'Sammlung',
    header: (userId: string, total: number, unique: number) =>
      `${mention.user(userId)}: ${plural(total, 'Karte', 'Karten')}, ${count(unique)} verschiedene`,
    unknown: (query: string) => `Hier gibt es keine Karte namens ${code(query)}.`,
    rarity: 'Seltenheit',
    deck: 'Deck',
    owners: 'Besitzer',
    yours: 'Du hast',
    wished: 'Gewünscht von',
    retired: 'Droppt nicht mehr.',
  },
  pack: {
    none: 'Hier gibt es noch keine Packs. Ein Admin kann im Dashboard welche anlegen.',
    unknown: (query: string, prefix: string) =>
      `Kein Pack namens ${code(query)}. ${code(`${prefix}shop`)} oder das Dashboard zeigt, was es gibt.`,
    pick: (names: string) => `Welches? ${names}`,
    economyOff: 'Packs kosten Geld, und Economy ist hier aus.',
    funds: (price: string, balance: string) => `Das Pack kostet ${price}. Du hast ${balance}.`,
    empty: 'Es gibt noch keine Karten zum Ziehen.',
    opened: (name: string, size: number) => `**${name}**, ${plural(size, 'Karte', 'Karten')}:`,
    fromInventory: 'Im Shop bezahlt',
    isNew: 'neu',
  },
  claim: {
    nothing: 'Hier gibt es nichts zu holen.',
    got: (name: string, rarity: string) => `**${name}** (${rarity}) gehört dir.`,
  },
  drop: {
    title: 'Eine Karte ist gedroppt',
    hint: (command: string, until: Date) =>
      `Wer zuerst ${code(command)} schreibt, bekommt sie. Weg ${timestamp(until, 'R')}.`,
    wished: (users: string[]) => `Gewünscht von ${users.map((id) => mention.user(id)).join(' ')}`,
    claimed: (userId: string) => `Geschnappt von ${mention.user(userId)}.`,
    expired: 'Niemand hat sie geholt.',
    noPool: 'Es gibt noch keine Karten zum Droppen.',
    noChannel: 'Kein Drop-Kanal eingestellt.',
  },
  trade: {
    off: 'Tauschen ist hier aus.',
    self: 'Mit dir selbst kannst du nicht tauschen.',
    bot: 'Bots sammeln keine Karten.',
    usage: (prefix: string) =>
      `${prefix}cards trade <mitglied> <deine karten> gegen <seine karten>`,
    empty: 'Nenn mindestens eine Karte, zum Beispiel #12.',
    tooMany: (max: number) => `Höchstens ${plural(max, 'Karte', 'Karten')} pro Seite.`,
    missing: (number: string) => `Du hast #${number} nicht.`,
    theyLack: (userId: string, number: string) => `${mention.user(userId)} hat #${number} nicht.`,
    busy: 'Einer von euch hat schon einen offenen Tausch. Bringt den erst zu Ende.',
    offer: (from: string, to: string, give: string, want: string) =>
      give && want
        ? `${mention.user(from)} bietet ${give} gegen ${want} von ${mention.user(to)}.`
        : give
          ? `${mention.user(from)} schenkt ${mention.user(to)} ${give}.`
          : `${mention.user(from)} fragt ${mention.user(to)} nach ${want}.`,
    confirm: (yes: string, no: string, until: Date) =>
      `Reagiert beide mit ${yes} zum Tauschen oder ${no} zum Abbrechen. Offen bis ${timestamp(until, 't')}.`,
    done: 'Getauscht.',
    cancelled: (userId: string) =>
      `${mention.user(userId)} hat abgebrochen. Nichts hat den Besitzer gewechselt.`,
    expired: 'Keine Antwort, also ist nichts passiert.',
    failed: 'Jemand hat die Karten nicht mehr, also hat nichts den Besitzer gewechselt.',
    nothing: 'nichts',
  },
  wishlist: {
    title: 'Wunschliste',
    empty: ['Deine Wunschliste ist leer.', 'Noch nichts auf deiner Wunschliste.'],
    which: 'Welche Karte?',
    added: (name: string) =>
      `**${name}** steht auf deiner Wunschliste. Ich ping dich, wenn sie droppt.`,
    exists: (name: string) => `**${name}** steht schon auf deiner Wunschliste.`,
    full: (max: number) => `Deine Wunschliste ist mit ${count(max)} voll. Nimm erst eine runter.`,
    removed: (name: string) => `**${name}** ist von deiner Wunschliste runter.`,
    notOn: (name: string) => `**${name}** war nicht auf deiner Wunschliste.`,
    usage: (prefix: string) => `${prefix}cards wishlist [add|remove] <karte>`,
  },
  sets: {
    title: 'Sets',
    empty: ['Hier gibt es noch keine Sets.', 'Noch gibt es keine Sets zum Vervollständigen.'],
    reward: (parts: string[]) => `Belohnung: ${andList(parts)}`,
    completed: (name: string, rewards: string[]) =>
      rewards.length > 0
        ? `Set komplett: **${name}**. ${andList(rewards)}.`
        : `Set komplett: **${name}**.`,
    completedBy: (userId: string, name: string, rewards: string[]) =>
      rewards.length > 0
        ? `${mention.user(userId)} hat das Set **${name}** komplett. ${andList(rewards)}.`
        : `${mention.user(userId)} hat das Set **${name}** komplett.`,
    progress: (owned: number, total: number) => `${count(owned)} / ${count(total)}`,
    roleReason: (name: string) => `Set ${name} komplett`,
  },
  optin: {
    off: 'Das Community-Deck ist hier aus.',
    done: 'Du bist jetzt im Community-Deck. Andere können deine Karte sammeln.',
    already: 'Du bist schon im Community-Deck.',
  },
  optout: {
    done: 'Du bist raus aus dem Community-Deck. Jede Kopie deiner Karte ist weg.',
    notIn: 'Du warst nicht im Community-Deck.',
  },
};

export default de;
