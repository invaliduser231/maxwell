import { EconomyStore, type Transaction } from '@maxwell/core/stores/economy';
import { voteBlocked } from '@/lib/access';
import { db } from '@/lib/db';
import { transactionRow } from '@/lib/economy-export';
import { viewer } from '@/lib/guard';

const PAGES = 50;

export async function GET(_request: Request, context: { params: Promise<{ guild: string }> }) {
  const { guild } = await context.params;
  const check = await viewer(guild, 'economy');
  if ('error' in check || voteBlocked(check.access, 'economy')) {
    return new Response('Not allowed', { status: 403 });
  }
  const store = new EconomyStore(db().sql);
  const rows: Transaction[] = [];
  let before: string | undefined;
  for (let page = 0; page < PAGES; page++) {
    const batch = await store.transactions(guild, { before, limit: 200 });
    rows.push(...batch);
    const last = batch.at(-1);
    if (batch.length < 200 || !last) break;
    before = last.id;
  }
  const lines = [
    ['id', 'time', 'member', 'amount', 'balance', 'kind', 'note', 'ref', 'counterpart'].join(','),
    ...rows.map(transactionRow),
  ];
  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="transactions-${guild}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
