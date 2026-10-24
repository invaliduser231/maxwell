import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { unseal } from '@/lib/crypto';
import { env } from '@/lib/env';
import { currentUser, exchangeCode } from '@/lib/fluxer';
import { createSession, SESSION_COOKIE, secureCookies } from '@/lib/session';

const OAUTH_COOKIE = 'mx_oauth';

function back(path: string): URL {
  return new URL(path, env().DASHBOARD_URL);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const store = await cookies();
  const raw = store.get(OAUTH_COOKIE)?.value;
  store.delete({ name: OAUTH_COOKIE, path: '/auth' });
  const saved = raw ? unseal(raw) : null;
  const pending = saved
    ? (JSON.parse(saved) as { state: string; verifier: string; next: string })
    : null;
  const code = params.get('code');

  if (params.get('error')) return NextResponse.redirect(back('/login?error=denied'));
  if (!pending || !code || params.get('state') !== pending.state) {
    return NextResponse.redirect(back('/login?error=expired'));
  }

  try {
    const tokens = await exchangeCode(code, pending.verifier);
    const user = await currentUser(tokens.accessToken);
    const session = await createSession(user, tokens);
    store.set(SESSION_COOKIE, session, {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });
    return NextResponse.redirect(back(pending.next));
  } catch {
    return NextResponse.redirect(back('/login?error=failed'));
  }
}
