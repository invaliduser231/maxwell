import { mention } from '../../commands/mentions.js';
import { andList, code, count, plural, timestamp } from '../../ui/format.js';
import type { CollectionCopy } from './copy.js';

const es: CollectionCopy = {
  commands: {
    cards: 'Colecciona cartas de tu comunidad y de mazos propios.',
    view: 'Tu colección, la de otra persona o una carta de cerca.',
    pack: 'Abre un sobre de cartas. Usa primero uno de la tienda; si no hay, pagas el precio.',
    trade: 'Ofrece cartas a un miembro a cambio de algunas suyas. Los dos tienen que aceptar.',
    wishlist: 'Cartas que quieres. Te aviso cuando salga una.',
    sets: 'Los sets de aquí y cuánto llevas.',
    optin: 'Pon tu propia carta en el mazo de la comunidad.',
    optout: 'Saca tu carta del mazo de la comunidad. Todas las copias desaparecen.',
    claim: 'Llévate la carta que acaba de salir aquí.',
  },
  communityDeck: 'Comunidad',
  unknownMember: 'No encuentro a ese miembro.',
  summary: {
    self: (total: number, unique: number) =>
      `Tienes **${plural(total, 'carta', 'cartas')}**, ${count(unique)} distintas.`,
    other: (userId: string, total: number, unique: number) =>
      `${mention.user(userId)} tiene **${plural(total, 'carta', 'cartas')}**, ${count(unique)} distintas.`,
    emptySelf: [
      'Todavía no tienes cartas. Espera un drop o abre un sobre.',
      'Tu colección está vacía por ahora.',
    ],
    emptyOther: (userId: string) => `${mention.user(userId)} todavía no tiene cartas.`,
    hint: (prefix: string) => `${prefix}cards view para ver la lista completa`,
  },
  view: {
    title: 'Colección',
    header: (userId: string, total: number, unique: number) =>
      `${mention.user(userId)}: ${plural(total, 'carta', 'cartas')}, ${count(unique)} distintas`,
    unknown: (query: string) => `Aquí no hay ninguna carta llamada ${code(query)}.`,
    rarity: 'Rareza',
    deck: 'Mazo',
    owners: 'La tienen',
    yours: 'Tienes',
    wished: 'La quieren',
    retired: 'Ya no sale en drops.',
  },
  pack: {
    none: 'Todavía no hay sobres aquí. Un admin puede añadir algunos en el panel.',
    unknown: (query: string, prefix: string) =>
      `No hay ningún sobre llamado ${code(query)}. ${code(`${prefix}shop`)} o el panel muestran los que existen.`,
    pick: (names: string) => `¿Cuál? ${names}`,
    economyOff: 'Los sobres cuestan dinero, y Economy está desactivado aquí.',
    funds: (price: string, balance: string) => `Ese sobre cuesta ${price}. Tienes ${balance}.`,
    empty: 'Todavía no hay cartas que sacar.',
    opened: (name: string, size: number) => `**${name}**, ${plural(size, 'carta', 'cartas')}:`,
    fromInventory: 'Pagado en la tienda',
    isNew: 'nueva',
  },
  claim: {
    nothing: 'Aquí no hay nada que reclamar.',
    got: (name: string, rarity: string) => `**${name}** (${rarity}) es tuya.`,
  },
  drop: {
    title: 'Salió una carta',
    hint: (command: string, until: Date) =>
      `Se la lleva quien escriba primero ${code(command)}. Desaparece ${timestamp(until, 'R')}.`,
    wished: (users: string[]) => `La quieren ${users.map((id) => mention.user(id)).join(' ')}`,
    claimed: (userId: string) => `Se la llevó ${mention.user(userId)}.`,
    expired: 'Nadie la reclamó.',
    noPool: 'Todavía no hay cartas para drops.',
    noChannel: 'No hay canal de drops.',
  },
  trade: {
    off: 'Los intercambios están desactivados aquí.',
    self: 'No puedes intercambiar contigo.',
    bot: 'Los bots no coleccionan cartas.',
    usage: (prefix: string) => `${prefix}cards trade <miembro> <tus cartas> por <sus cartas>`,
    empty: 'Indica al menos una carta, por ejemplo #12.',
    tooMany: (max: number) => `Hasta ${plural(max, 'carta', 'cartas')} por lado.`,
    missing: (number: string) => `No tienes la #${number}.`,
    theyLack: (userId: string, number: string) => `${mention.user(userId)} no tiene la #${number}.`,
    busy: 'Uno de ustedes ya tiene un intercambio abierto. Termínalo primero.',
    offer: (from: string, to: string, give: string, want: string) =>
      give && want
        ? `${mention.user(from)} ofrece ${give} a cambio de ${want} de ${mention.user(to)}.`
        : give
          ? `${mention.user(from)} le da ${give} a ${mention.user(to)}.`
          : `${mention.user(from)} le pide ${want} a ${mention.user(to)}.`,
    confirm: (yes: string, no: string, until: Date) =>
      `Los dos reaccionan con ${yes} para intercambiar o con ${no} para cancelar. Abierto hasta ${timestamp(until, 't')}.`,
    done: 'Intercambio hecho.',
    cancelled: (userId: string) => `Cancelado por ${mention.user(userId)}. Nada cambió de manos.`,
    expired: 'Sin respuesta, así que no pasó nada.',
    failed: 'Alguien ya no tiene esas cartas, así que nada cambió de manos.',
    nothing: 'nada',
  },
  wishlist: {
    title: 'Lista de deseos',
    empty: ['Tu lista de deseos está vacía.', 'Todavía no hay nada en tu lista de deseos.'],
    which: '¿Qué carta?',
    added: (name: string) => `**${name}** está en tu lista de deseos. Te aviso cuando salga.`,
    exists: (name: string) => `**${name}** ya está en tu lista de deseos.`,
    full: (max: number) => `Tu lista de deseos está llena (${count(max)}). Quita una primero.`,
    removed: (name: string) => `**${name}** ya no está en tu lista de deseos.`,
    notOn: (name: string) => `**${name}** no estaba en tu lista de deseos.`,
    usage: (prefix: string) => `${prefix}cards wishlist [add|remove] <carta>`,
  },
  sets: {
    title: 'Sets',
    empty: ['Todavía no hay sets aquí.', 'Todavía no hay sets que completar.'],
    reward: (parts: string[]) => `Recompensa: ${andList(parts)}`,
    completed: (name: string, rewards: string[]) =>
      rewards.length > 0
        ? `Set completo: **${name}**. ${andList(rewards)}.`
        : `Set completo: **${name}**.`,
    completedBy: (userId: string, name: string, rewards: string[]) =>
      rewards.length > 0
        ? `${mention.user(userId)} completó el set **${name}**. ${andList(rewards)}.`
        : `${mention.user(userId)} completó el set **${name}**.`,
    progress: (owned: number, total: number) => `${count(owned)} / ${count(total)}`,
    roleReason: (name: string) => `Completó el set ${name}`,
  },
  optin: {
    off: 'El mazo de la comunidad está desactivado aquí.',
    done: 'Ya estás en el mazo de la comunidad. Otras personas pueden coleccionar tu carta.',
    already: 'Ya estás en el mazo de la comunidad.',
  },
  optout: {
    done: 'Saliste del mazo de la comunidad. Todas las copias de tu carta desaparecieron.',
    notIn: 'No estabas en el mazo de la comunidad.',
  },
};

export default es;
