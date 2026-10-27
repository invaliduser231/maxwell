import 'server-only';
import type { CollectionConfig } from '@maxwell/core/modules/collection';
import type { EconomyConfig } from '@maxwell/core/modules/economy';
import { EconomyStore, type Transaction } from '@maxwell/core/stores/economy';
import { db } from '@/lib/db';
import type { Key, Translator } from '@/lib/i18n';
import { getT } from '@/lib/i18n/server';
import { people, personOf } from '@/lib/people';
import { ago } from '@/lib/time';

export const LEDGER_PAGE = 8;

export interface LedgerRow {
  id: string;
  text: string;
  when: string;
  amount: string;
  up: boolean;
}

const gameNames: Record<string, Key> = {
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
  t: Translator,
  row: Transaction,
  name: string,
  other: string,
  economy: EconomyConfig,
  collection: CollectionConfig,
): string {
  const symbol = economy.currency.symbol;
  const ref = row.ref ?? '';
  const game = gameNames[ref];
  switch (row.kind) {
    case 'message':
      return t('{name} earned from chatting', { name });
    case 'daily':
      return t('{name} claimed daily', { name });
    case 'event':
      return row.note
        ? t('{name} got a reward for {event}', { name, event: row.note })
        : t('{name} got an event reward', { name });
    case 'game':
      return t('{name} won {game}', { name, game: game ? t(game) : t('a game') });
    case 'stake':
      return t('{name} staked on {game}', { name, game: game ? t(game) : t('a game') });
    case 'refund':
      return t('{name} got a refund', { name });
    case 'shop':
      return t('{name} bought {item}', {
        name,
        item: economy.shop.find((item) => item.id === ref)?.name ?? ref,
      });
    case 'pack':
      return t('{name} bought {item}', {
        name,
        item: collection.packs.find((pack) => pack.id === ref)?.name ?? t('a pack'),
      });
    case 'set':
      return t('{name} completed {set}', {
        name,
        set: collection.sets.find((set) => set.id === ref)?.name ?? t('a set'),
      });
    case 'transfer': {
      if (row.amount > 0) {
        return t('{name} got {amount} {symbol} from {other}', {
          name,
          amount: row.amount,
          symbol,
          other,
        });
      }
      const cut = tax(row.note);
      return cut > 0
        ? t('{name} sent {other} {amount} {symbol} ({tax} {symbol} tax)', {
            name,
            other,
            amount: -row.amount,
            symbol,
            tax: cut,
          })
        : t('{name} sent {other} {amount} {symbol}', {
            name,
            other,
            amount: -row.amount,
            symbol,
          });
    }
    case 'admin':
      return row.amount > 0
        ? t('{other} gave {name}', { other, name })
        : t('{other} took from {name}', { other, name });
    case 'reset':
      return t('{name} lost it in a reset', { name });
    case 'undo':
      return t('Undone for {name}', { name });
    case 'start':
      return t('{name} got the starting balance', { name });
    default:
      return `${name}, ${row.kind}`;
  }
}

function signed(t: Translator, value: number, symbol: string): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${t.count(Math.abs(value))} ${symbol}`;
}

export async function ledgerRows(
  rows: readonly Transaction[],
  economy: EconomyConfig,
  collection: CollectionConfig,
): Promise<LedgerRow[]> {
  const [names, t] = await Promise.all([
    people(rows.flatMap((row) => [row.userId, row.counterpartId])),
    getT(),
  ]);
  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    text: describe(
      t,
      row,
      personOf(names, row.userId).name,
      row.counterpartId ? personOf(names, row.counterpartId).name : t('An admin'),
      economy,
      collection,
    ),
    when: ago(t, row.createdAt, now),
    amount: signed(t, row.amount, economy.currency.symbol),
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
