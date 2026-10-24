export const dynamic = 'force-dynamic';

export function GET() {
  return new Response('ok', { headers: { 'cache-control': 'no-store' } });
}
