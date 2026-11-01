import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { seal, token } from '@/lib/crypto';
import { env } from '@/lib/env';
import { authorizeUrl } from '@/lib/fluxer';
import { secureCookies } from '@/lib/session';

const OAUTH_COOKIE = 'mx_oauth';

function safeNext(value: string | null): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/communities';
  const base = new URL(env().DASHBOARD_URL);
  return URL.parse(value, base)?.origin === base.origin ? value : '/communities';
}

export async function GET(request: NextRequest) {
  const state = token(24);
  const verifier = token(48);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const next = safeNext(request.nextUrl.searchParams.get('next'));
  const store = await cookies();
  store.set(OAUTH_COOKIE, seal(JSON.stringify({ state, verifier, next })), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/auth',
    maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl(state, challenge));
}
