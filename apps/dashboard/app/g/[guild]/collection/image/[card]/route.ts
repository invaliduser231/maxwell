import { db } from '@/lib/db';
import { viewer } from '@/lib/guard';

export async function GET(
  _request: Request,
  context: { params: Promise<{ guild: string; card: string }> },
) {
  const { guild, card } = await context.params;
  if (!/^\d{1,18}$/.test(card)) return new Response(null, { status: 404 });
  const check = await viewer(guild, 'collection');
  if ('error' in check) return new Response(null, { status: 403 });
  const [row] = await db().sql<{ contentType: string; data: Uint8Array }[]>`
    select a.content_type as "contentType", a.data
    from collection_cards c
    join guild_assets a on a.guild_id = c.guild_id and a.key = c.asset_key
    where c.guild_id = ${guild} and c.id = ${card}
  `;
  if (!row) return new Response(null, { status: 404 });
  return new Response(Buffer.from(row.data), {
    headers: { 'content-type': row.contentType, 'cache-control': 'private, max-age=86400' },
  });
}
