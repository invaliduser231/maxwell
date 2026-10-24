import { db } from '@/lib/db';
import { viewer } from '@/lib/guard';

export async function GET(_request: Request, { params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const check = await viewer(guild, 'cards');
  if ('error' in check) return new Response(null, { status: 404 });
  const [row] = await db().sql<{ data: Uint8Array; contentType: string }[]>`
    select data, content_type as "contentType" from guild_assets
    where guild_id = ${guild} and key = 'card-background'
  `;
  if (!row) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(row.data), {
    headers: {
      'content-type': row.contentType,
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
}
