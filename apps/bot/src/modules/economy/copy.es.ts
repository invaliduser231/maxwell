import { mention } from '../../commands/mentions.js';
import { code, count, timestamp } from '../../ui/format.js';
import type { EconomyCopy } from './copy.js';
import { type Currency, money } from './wallets.js';

const es: EconomyCopy = {
  commands: {
    balance: 'Cuánto tienes tú u otra persona.',
    daily: 'Recoge tu recompensa diaria. Vuelve cada día para mantener la racha.',
    pay: 'Envía dinero a otro miembro. Una parte se va en impuestos.',
    shop: 'Lo que puedes comprar aquí.',
    buy: 'Compra algo en la tienda.',
    rich: 'Quién tiene más.',
  },
  balance: {
    self: (amount: number, c: Currency) => `Tienes ${money(amount, c)}.`,
    other: (userId: string, amount: number, c: Currency) =>
      `${mention.user(userId)} tiene ${money(amount, c)}.`,
    rank: (rank: number) => `#${count(rank)} aquí`,
    today: (earned: number, cap: number) => `${count(earned)} de ${count(cap)} ganados hoy`,
    emptySelf: ['Nada todavía. Escribe un poco, todo suma.', 'Vacío por ahora.', 'Ni uno todavía.'],
  },
  daily: {
    off: 'Las recompensas diarias están desactivadas aquí.',
    claimed: (amount: number, streak: number, c: Currency) =>
      streak > 1
        ? `+${money(amount, c)}. ${count(streak)} días seguidos.`
        : `+${money(amount, c)}.`,
    next: (at: Date) => `La próxima ${timestamp(at, 'R')}`,
    wait: (command: string, at: Date) =>
      `${code(command)} vuelve a estar disponible ${timestamp(at, 'R')}.`,
    slow: ['Con calma.', 'De uno en uno.'],
  },
  pay: {
    self: 'No puedes enviarte dinero a ti.',
    bot: 'Los bots no necesitan dinero.',
    unknown: 'No encuentro a ese miembro.',
    tooSmall: 'Envía al menos 1.',
    broke: (amount: number, c: Currency) => `Solo tienes ${money(amount, c)}.`,
    sent: (userId: string, received: number, tax: number, c: Currency) =>
      tax > 0
        ? `Enviaste ${money(received, c)} a ${mention.user(userId)}. ${money(tax, c)} se fueron en impuestos.`
        : `Enviaste ${money(received, c)} a ${mention.user(userId)}.`,
  },
  shop: {
    title: 'Tienda',
    empty: [
      'La tienda está vacía. Un admin puede llenarla desde el panel.',
      'Todavía no hay nada a la venta.',
    ],
    soldOut: 'agotado',
    left: (n: number) => `quedan ${count(n)}`,
    hint: (prefix: string) => `${prefix}buy <item>`,
    kinds: {
      role: 'Rol',
      pack: 'Sobre de cartas',
      background: 'Fondo de perfil',
      giveaway: 'Participación en sorteo',
    } as Record<string, string>,
  },
  buy: {
    unknown: (query: string, prefix: string) =>
      `No hay nada llamado ${code(query)} en la tienda. ${code(`${prefix}shop`)} muestra lo que hay.`,
    soldOut: (name: string) => `**${name}** está agotado.`,
    limit: (name: string) => `Ya compraste **${name}** todas las veces posibles.`,
    funds: (price: number, balance: number, c: Currency) =>
      `Cuesta ${money(price, c)}. Tienes ${money(balance, c)}.`,
    roleGone: 'Ese rol ya no existe. Un admin tiene que arreglar este artículo en el panel.',
    roleHeld: (roleId: string) => `Ya tienes ${mention.role(roleId)}.`,
    roleFailed: (roleId: string) =>
      `No pude darte ${mention.role(roleId)}, así que el dinero volvió a tu cartera.`,
    role: (roleId: string, until: Date | null) =>
      until
        ? `${mention.role(roleId)} es tuyo hasta ${timestamp(until, 'f')}.`
        : `${mention.role(roleId)} es tuyo.`,
    pack: (name: string, command: string) => `**${name}** es tuyo. Ábrelo con ${code(command)}.`,
    background: (name: string) => `**${name}** ya está en tu perfil.`,
    equipped: (name: string) => `Ya tienes **${name}**. Vuelve a estar en tu perfil.`,
    giveaway: (name: string) => `**${name}** es tuyo. Cuenta en el próximo sorteo.`,
    where: 'en esta comunidad',
  },
  rich: {
    title: 'Los más ricos',
    empty: ['Nadie tiene nada todavía.', 'Todas las carteras están vacías. Muy equitativo.'],
    you: (rank: number, amount: string) => `Tú: #${count(rank)} con ${amount}`,
    notYou: 'Todavía no apareces en la lista',
  },
  reasons: {
    bought: (name: string) => `Compró ${name} en la tienda`,
    refunded: 'Compra en la tienda reembolsada',
    expired: 'Rol de la tienda vencido',
  },
};

export default es;
