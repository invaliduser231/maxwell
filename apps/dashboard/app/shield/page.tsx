import Link from 'next/link';
import { TopBar } from '@/components/top-bar';
import { Row } from '@/components/ui';
import { requireUser } from '@/lib/access';
import { getT, titled } from '@/lib/i18n/server';
import { date } from '@/lib/time';
import { type DisputeView, type ListingView, shieldState } from './data';
import { DisputeForm } from './dispute-form';
import { sourceLabels } from './labels';
import { isOperator } from './review/data';

export const generateMetadata = titled('Maxwell Shield');

export default async function ShieldPage() {
  const user = await requireUser('/shield');
  const [state, t] = await Promise.all([shieldState(user.id), getT()]);

  const listing = (entries: ListingView[]) => (
    <div className="mx-stack" style={{ width: '100%', gap: 8, textAlign: 'left' }}>
      <p style={{ margin: 0 }}>{t('You are listed in Maxwell Shield.')}</p>
      <p className="mx-sub" style={{ margin: 0 }}>
        {t.plural(entries.length, 'Reported by {n} community.', 'Reported by {n} communities.')}
      </p>
      <div>
        {entries.map((entry) => (
          <Row
            key={`${entry.source}-${entry.createdAt}-${entry.expiresAt}`}
            title={t(sourceLabels[entry.source])}
            sub={t('Since {date}, expires {expires}', {
              date: date(t, entry.createdAt, 'UTC'),
              expires: date(t, entry.expiresAt, 'UTC'),
            })}
          />
        ))}
      </div>
    </div>
  );

  const outcome = (last: DisputeView | null) => {
    if (!last?.decidedAt || last.status === 'open') return null;
    return (
      <div className="mx-stack" style={{ width: '100%', gap: 4, textAlign: 'left' }}>
        <p style={{ margin: 0 }}>
          {last.status === 'removed'
            ? t('Your dispute was accepted on {date}.', { date: date(t, last.decidedAt, 'UTC') })
            : t('Your dispute was declined on {date}.', { date: date(t, last.decidedAt, 'UTC') })}
        </p>
        {last.note ? (
          <p className="mx-sub" style={{ margin: 0 }}>
            {last.note}
          </p>
        ) : null}
      </div>
    );
  };

  let body: React.ReactNode;
  switch (state.kind) {
    case 'not-listed':
      body = (
        <>
          <p className="mx-sub" style={{ margin: 0 }}>
            {t('You are not listed in Maxwell Shield.')}
          </p>
          {outcome(state.last)}
        </>
      );
      break;
    case 'open':
      body = (
        <>
          {state.listing.length > 0 ? listing(state.listing) : null}
          <p style={{ margin: 0 }}>{t('Your dispute is with the operators of Maxwell.')}</p>
          <p className="mx-sub" style={{ margin: 0 }}>
            {t('You get a direct message when they decide.')}
          </p>
        </>
      );
      break;
    case 'wait':
      body = (
        <>
          {listing(state.listing)}
          {outcome(state.last)}
          <p className="mx-sub" style={{ margin: 0 }}>
            {t('You can dispute again on {date}.', { date: date(t, state.until, 'UTC') })}
          </p>
        </>
      );
      break;
    case 'ready':
      body = (
        <>
          {listing(state.listing)}
          {outcome(state.last)}
          <DisputeForm />
        </>
      );
      break;
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar user={{ name: user.displayName, avatarUrl: user.avatarUrl }} />
      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '48px 16px',
        }}
      >
        <div
          className="mx-panel"
          style={{
            width: '100%',
            maxWidth: 560,
            padding: '24px 22px 22px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
            textAlign: 'center',
          }}
        >
          <div className="mx-stack" style={{ gap: 4, alignItems: 'center' }}>
            <h1 className="mx-h1">{t('Maxwell Shield')}</h1>
            <span className="mx-sub">{user.displayName}</span>
          </div>
          {body}
          {isOperator(user.id) ? (
            <Link href="/shield/review" className="mx-sub">
              {t('Review disputes')}
            </Link>
          ) : null}
        </div>
      </main>
    </div>
  );
}
