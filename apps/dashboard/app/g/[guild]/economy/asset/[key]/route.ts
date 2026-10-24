import { db } from '@/lib/db';
import { viewer } from '@/lib/guard';

export async function GET(
  _request: Request,
  context: { params: Promise<{ guild: string; key: string }> },
) {
  const { guild, key } = await context.params;
  if (!/^shop-bg-[a-z0-9-]{1,40}$/.test(key)) return new Response(null, { status: 404 });
  const check = await viewer(guild, 'economy');
  if ('error' in check) return new Response(null, { status: 403 });
  const [row] = await db().sql<{ contentType: string; data: Uint8Array }[]>`
    select content_type as "contentType", data from guild_assets
    where guild_id = ${guild} and key = ${key}
  `;
  if (!row) return new Response(null, { status: 404 });
  return new Response(Buffer.from(row.data), {
    headers: { 'content-type': row.contentType, 'cache-control': 'private, max-age=86400' },
  });
}
