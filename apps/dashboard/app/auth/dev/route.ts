import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { userProfile } from '@/lib/fluxer';
import { createSession, DEV_TOKEN, devLoginEnabled, SESSION_COOKIE } from '@/lib/session';

export async function GET() {
  const userId = env().OWNER_IDS[0];
  if (!devLoginEnabled() || !userId) return new NextResponse(null, { status: 404 });
  const profile = await userProfile(userId);
  if (!profile) return new NextResponse(null, { status: 404 });
  const session = await createSession(profile, {
    accessToken: DEV_TOKEN,
    refreshToken: DEV_TOKEN,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, session, { httpOnly: true, sameSite: 'lax', path: '/' });
  return NextResponse.redirect(new URL('/', env().DASHBOARD_URL));
}
