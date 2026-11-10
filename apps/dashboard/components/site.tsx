import Link from 'next/link';
import { env } from '@/lib/env';
import { inviteUrl } from '@/lib/fluxer';
import { getT } from '@/lib/i18n/server';
import { getSession } from '@/lib/session';
import { AccountMenu } from './account-menu';
import { Logo } from './ui';
import '../app/landing.css';

export async function SiteHeader({ sections = false }: { sections?: boolean }) {
  const [t, session] = await Promise.all([getT(), getSession()]);
  const invite = inviteUrl();
  const source = env().SOURCE_URL;
  const user = session
    ? { name: session.user.displayName, avatarUrl: session.user.avatarUrl }
    : null;

  return (
    <header className="mx-land-wrap mx-land-head">
      <Link href="/" className="mx-land-brand">
        <Logo size={32} />
        <span>Maxwell</span>
      </Link>
      <nav aria-label={t('Main')} className="mx-land-nav">
        {sections ? (
          <>
            <a href="#modules" className="mx-land-link">
              {t('Modules')}
            </a>
            <a href="#cards" className="mx-land-link">
              {t('Cards')}
            </a>
          </>
        ) : null}
        {source ? (
          <a href={source} className="mx-land-link">
            GitHub
          </a>
        ) : null}
        <Link href="/communities" className="mx-land-link">
          {user ? t('Dashboard') : t('Sign in')}
        </Link>
        {invite ? (
          <a href={invite} className="mx-btn mx-btn-primary mx-land-head-invite">
            {t('Invite')}
          </a>
        ) : null}
        <AccountMenu user={user} />
      </nav>
    </header>
  );
}

export async function SiteFooter() {
  const t = await getT();
  const source = env().SOURCE_URL;

  return (
    <footer className="mx-land-foot">
      <div className="mx-land-wrap mx-land-foot-inner">
        <div className="mx-land-foot-brand">
          <Logo size={56} />
          <p>
            {t("Named after Maxwell's demon, the 1867 thought experiment about sorting molecules.")}
          </p>
        </div>
        <nav aria-label={t('Footer')} className="mx-land-foot-nav">
          <Link href="/communities">{t('Dashboard')}</Link>
          <Link href="/templates">{t('Templates')}</Link>
          <Link href="/shield">{t('Maxwell Shield')}</Link>
          {source ? <a href={source}>GitHub</a> : null}
          <Link href="/imprint">{t('Imprint')}</Link>
          <Link href="/privacy">{t('Privacy')}</Link>
          <Link href="/terms">{t('Terms')}</Link>
        </nav>
      </div>
      <div className="mx-land-wrap mx-land-foot-base">
        {t('Not affiliated with Fluxer Platform AB.')}
      </div>
    </footer>
  );
}
