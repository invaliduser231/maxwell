import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { seal, token } from '@/lib/crypto';
import { authorizeUrl } from '@/lib/fluxer';
import { secureCookies } from '@/lib/session';

const OAUTH_COOKIE = 'mx_oauth';

function safeNext(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/';
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
