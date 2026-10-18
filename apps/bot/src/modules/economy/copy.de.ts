import { mention } from '../../commands/mentions.js';
import { code, count, ordinal, timestamp } from '../../ui/format.js';
import type { EconomyCopy } from './copy.js';
import { type Currency, money } from './wallets.js';

const de: EconomyCopy = {
  commands: {
    balance: 'Wie viel du oder jemand anderes hat.',
    daily: 'Hol dir deine tägliche Belohnung. Komm jeden Tag wieder, dann wächst die Serie.',
    pay: 'Schick einem anderen Mitglied Geld. Ein Teil geht als Steuer weg.',
    shop: 'Was du hier kaufen kannst.',
    buy: 'Kauf etwas im Shop.',
    rich: 'Wer am meisten hat.',
  },
  balance: {
    self: (amount: number, c: Currency) => `Du hast ${money(amount, c)}.`,
    other: (userId: string, amount: number, c: Currency) =>
      `${mention.user(userId)} hat ${money(amount, c)}.`,
    rank: (rank: number) => `Platz ${count(rank)} hier`,
    today: (earned: number, cap: number) => `Heute ${count(earned)} von ${count(cap)} verdient`,
    emptySelf: [
      'Noch nichts. Schreib ein bisschen, das läppert sich.',
      'Bisher leer.',
      'Noch kein einziges.',
    ],
  },
  daily: {
    off: 'Tägliche Belohnungen sind hier aus.',
    claimed: (amount: number, streak: number, c: Currency) =>
      streak > 1
        ? `+${money(amount, c)}. ${ordinal(streak)} Tag in Folge.`
        : `+${money(amount, c)}.`,
    next: (at: Date) => `Die nächste ${timestamp(at, 'R')}`,
    wait: (command: string, at: Date) => `${code(command)} geht wieder ${timestamp(at, 'R')}.`,
    slow: ['Langsam.', 'Eins nach dem anderen.'],
  },
  pay: {
    self: 'Dich selbst kannst du nicht bezahlen.',
    bot: 'Bots brauchen kein Geld.',
    unknown: 'Dieses Mitglied finde ich nicht.',
    tooSmall: 'Schick mindestens 1.',
    broke: (amount: number, c: Currency) => `Du hast nur ${money(amount, c)}.`,
    sent: (userId: string, received: number, tax: number, c: Currency) =>
      tax > 0
        ? `${money(received, c)} an ${mention.user(userId)} geschickt. ${money(tax, c)} gingen als Steuer weg.`
        : `${money(received, c)} an ${mention.user(userId)} geschickt.`,
  },
  shop: {
    title: 'Shop',
    empty: [
      'Der Shop ist leer. Ein Admin kann ihn im Dashboard füllen.',
      'Noch gibt es nichts zu kaufen.',
    ],
    soldOut: 'ausverkauft',
    left: (n: number) => `noch ${count(n)}`,
    hint: (prefix: string) => `${prefix}buy <item>`,
    kinds: {
      role: 'Rolle',
      pack: 'Kartenpack',
      background: 'Profilhintergrund',
      giveaway: 'Giveaway-Los',
    } as Record<string, string>,
  },
  buy: {
    unknown: (query: string, prefix: string) =>
      `Im Shop gibt es nichts namens ${code(query)}. ${code(`${prefix}shop`)} zeigt, was da ist.`,
    soldOut: (name: string) => `**${name}** ist ausverkauft.`,
    limit: (name: string) => `**${name}** hast du schon so oft gekauft, wie es geht.`,
    funds: (price: number, balance: number, c: Currency) =>
      `Das kostet ${money(price, c)}. Du hast ${money(balance, c)}.`,
    roleGone: 'Die Rolle gibt es nicht mehr. Ein Admin muss den Artikel im Dashboard reparieren.',
    roleHeld: (roleId: string) => `Du hast ${mention.role(roleId)} schon.`,
    roleFailed: (roleId: string) =>
      `Ich konnte dir ${mention.role(roleId)} nicht geben, das Geld ist wieder bei dir.`,
    role: (roleId: string, until: Date | null) =>
      until
        ? `${mention.role(roleId)} gehört dir bis ${timestamp(until, 'f')}.`
        : `${mention.role(roleId)} gehört jetzt dir.`,
    pack: (name: string, command: string) =>
      `**${name}** gehört dir. Öffnen kannst du es mit ${code(command)}.`,
    background: (name: string) => `**${name}** ist jetzt auf deinem Profil.`,
    equipped: (name: string) => `**${name}** hast du schon. Er ist wieder auf deinem Profil.`,
    giveaway: (name: string) => `**${name}** gehört dir. Es zählt beim nächsten Giveaway.`,
    where: 'in dieser Community',
  },
  rich: {
    title: 'Am reichsten',
    empty: ['Noch hat niemand etwas.', 'Alle Geldbörsen sind leer. Sehr gerecht.'],
    you: (rank: number, amount: string) => `Du: Platz ${count(rank)} mit ${amount}`,
    notYou: 'Du stehst noch nicht auf der Liste',
  },
  reasons: {
    bought: (name: string) => `${name} im Shop gekauft`,
    refunded: 'Shop-Kauf erstattet',
    expired: 'Shop-Rolle abgelaufen',
  },
};

export default de;
