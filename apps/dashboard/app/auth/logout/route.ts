import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { destroySession } from '@/lib/session';

function sameSite(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  return origin !== null && host !== null && URL.parse(origin)?.host === host;
}

export async function POST(request: NextRequest) {
  if (!sameSite(request)) return new Response('Not allowed', { status: 403 });
  await destroySession();
  return NextResponse.redirect(new URL('/login', env().DASHBOARD_URL), 303);
}
