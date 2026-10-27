import { redirect } from 'next/navigation';
import { TopBar } from '@/components/top-bar';
import { Logo } from '@/components/ui';
import { oauth } from '@/lib/env';
import type { Key } from '@/lib/i18n';
import { getT, titled } from '@/lib/i18n/server';
import { devLoginEnabled, getSession } from '@/lib/session';

export const generateMetadata = titled('Sign in');

const errors: Record<string, Key> = {
  denied: 'Sign-in was cancelled.',
  expired: 'That sign-in link expired. Try again.',
  failed: 'Fluxer did not let me in. Try again in a moment.',
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  if (await getSession()) redirect(next?.startsWith('/') ? next : '/communities');
  const start = `/auth/start${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  const t = await getT();
  const message = error ? errors[error] : undefined;

  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <TopBar overlay />
      <main
        style={{
          position: 'relative',
          overflow: 'hidden',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '96px 16px',
        }}
      >
        <div style={{ position: 'relative', width: '100%', maxWidth: 360 }}>
          <svg
            width="1100"
            height="3000"
            viewBox="0 0 1100 3000"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '50%',
              top: -192,
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              overflow: 'visible',
            }}
          >
            <g fill="none" stroke="#F26B3A" strokeWidth="3">
              <path d="M370 3000V350a180 180 0 0 1 360 0v2650" strokeOpacity=".4" />
              <path d="M310 3000V350a240 240 0 0 1 480 0v2650" strokeOpacity=".26" />
              <path d="M245 3000V350a305 305 0 0 1 610 0v2650" strokeOpacity=".16" />
              <path d="M175 3000V350a375 375 0 0 1 750 0v2650" strokeOpacity=".1" />
              <path d="M100 3000V350a450 450 0 0 1 900 0v2650" strokeOpacity=".06" />
            </g>
          </svg>
          <div
            className="mx-panel"
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 360,
              padding: '28px 24px 22px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
              textAlign: 'center',
            }}
          >
            <Logo size={64} />
            <h1 className="mx-h1">Maxwell</h1>
            {message ? (
              <p className="mx-status mx-status-error" role="alert" style={{ margin: 0 }}>
                {t(message)}
              </p>
            ) : null}
            {oauth() ? (
              <a
                className="mx-btn mx-btn-primary"
                href={start}
                style={{ width: '100%', justifyContent: 'center', minHeight: 42, fontSize: 14 }}
              >
                {t('Sign in with Fluxer')}
              </a>
            ) : (
              <p className="mx-sub" style={{ margin: 0 }}>
                {t('Sign-in is not set up yet.')}
              </p>
            )}
            {devLoginEnabled() ? (
              <a
                className="mx-btn"
                href="/auth/dev"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {t('Development login')}
              </a>
            ) : null}
            <a href="/privacy" className="mx-sub">
              {t('Privacy')}
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
