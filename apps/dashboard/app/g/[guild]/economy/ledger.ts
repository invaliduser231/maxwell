import 'server-only';
import type { CollectionConfig } from '@maxwell/core/modules/collection';
import type { EconomyConfig } from '@maxwell/core/modules/economy';
import { EconomyStore, type Transaction } from '@maxwell/core/stores/economy';
import { db } from '@/lib/db';
import { people, personOf } from '@/lib/people';
import { ago } from '@/lib/time';
import { amount, signed } from './format';

export const LEDGER_PAGE = 8;

export interface LedgerRow {
  id: string;
  text: string;
  when: string;
  amount: string;
  up: boolean;
}

const gameNames: Record<string, string> = {
  trivia: 'trivia',
  counting: 'counting',
  wordchain: 'word chain',
  higherlower: 'higher or lower',
  coinflip: 'a coinflip',
};

function tax(note: string | null): number {
  const match = note ? /^tax (\d+)$/.exec(note) : null;
  return match ? Number(match[1]) : 0;
}

function describe(
  row: Transaction,
  name: string,
  other: string,
  economy: EconomyConfig,
  collection: CollectionConfig,
): string {
  const symbol = economy.currency.symbol;
  const ref = row.ref ?? '';
  switch (row.kind) {
    case 'message':
      return `${name} earned from chatting`;
    case 'daily':
      return `${name} claimed daily`;
    case 'event':
      return row.note ? `${name} got a reward for ${row.note}` : `${name} got an event reward`;
    case 'game':
      return `${name} won ${gameNames[ref] ?? 'a game'}`;
    case 'stake':
      return `${name} staked on ${gameNames[ref] ?? 'a game'}`;
    case 'refund':
      return `${name} got a refund`;
    case 'shop':
      return `${name} bought ${economy.shop.find((item) => item.id === ref)?.name ?? ref}`;
    case 'pack':
      return `${name} bought ${collection.packs.find((pack) => pack.id === ref)?.name ?? 'a pack'}`;
    case 'set':
      return `${name} completed ${collection.sets.find((set) => set.id === ref)?.name ?? 'a set'}`;
    case 'transfer': {
      if (row.amount > 0) return `${name} got ${amount(row.amount)} ${symbol} from ${other}`;
      const cut = tax(row.note);
      return cut > 0
        ? `${name} sent ${other} ${amount(-row.amount)} ${symbol} (${amount(cut)} ${symbol} tax)`
        : `${name} sent ${other} ${amount(-row.amount)} ${symbol}`;
    }
    case 'admin':
      return row.amount > 0 ? `${other} gave ${name}` : `${other} took from ${name}`;
    case 'reset':
      return `${name} lost it in a reset`;
    case 'undo':
      return `Undone for ${name}`;
    case 'start':
      return `${name} got the starting balance`;
    default:
      return `${name}, ${row.kind}`;
  }
}

export async function ledgerRows(
  rows: readonly Transaction[],
  economy: EconomyConfig,
  collection: CollectionConfig,
): Promise<LedgerRow[]> {
  const names = await people(rows.flatMap((row) => [row.userId, row.counterpartId]));
  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    text: describe(
      row,
      personOf(names, row.userId).name,
      row.counterpartId ? personOf(names, row.counterpartId).name : 'An admin',
      economy,
      collection,
    ),
    when: ago(row.createdAt, now),
    amount: signed(row.amount, economy.currency.symbol),
    up: row.amount > 0,
  }));
}

export async function ledgerPage(
  guildId: string,
  economy: EconomyConfig,
  collection: CollectionConfig,
  before?: string,
): Promise<{ rows: LedgerRow[]; next: string | null }> {
  const store = new EconomyStore(db().sql);
  const rows = await store.transactions(guildId, { before, limit: LEDGER_PAGE + 1 });
  const page = rows.slice(0, LEDGER_PAGE);
  const last = page.at(-1);
  return {
    rows: await ledgerRows(page, economy, collection),
    next: rows.length > LEDGER_PAGE && last ? last.id : null,
  };
}
