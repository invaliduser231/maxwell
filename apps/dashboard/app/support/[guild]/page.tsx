import Link from 'next/link';
import { TopBar } from '@/components/top-bar';
import { Avatar } from '@/components/ui';
import { requireUser } from '@/lib/access';
import { getT, titled } from '@/lib/i18n/server';
import { date } from '@/lib/time';
import { supportState } from './data';
import { SupportForm } from './support-form';

export const generateMetadata = titled('Support');

export default async function SupportPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const user = await requireUser(`/support/${guild}`);
  const [state, t] = await Promise.all([supportState(guild, user.id), getT()]);
  const info = state.kind === 'closed' ? null : state.guild;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar user={{ name: user.displayName, avatarUrl: user.avatarUrl }} />
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
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
          {info ? <Avatar src={info.iconUrl} name={info.name} size={56} /> : null}
          <div className="mx-stack" style={{ gap: 4, alignItems: 'center' }}>
            <h1 className="mx-h1">{t('Support')}</h1>
            {info ? <span className="mx-sub">{info.name}</span> : null}
          </div>
          {state.kind === 'closed' ? (
            <p className="mx-sub">{t('This community does not take tickets on the web.')}</p>
          ) : state.kind === 'not-member' ? (
            <p className="mx-sub">
              {t('Only members of {server} can open tickets here.', { server: state.guild.name })}
            </p>
          ) : (
            <SupportForm guildId={guild} panels={state.panels} />
          )}
        </div>

        {state.kind === 'ready' && state.tickets.length > 0 ? (
          <section className="mx-panel" style={{ width: '100%', maxWidth: 560 }}>
            <div className="mx-panel-head">
              <h2>{t('Your tickets')}</h2>
            </div>
            {state.tickets.map((ticket) => (
              <div key={ticket.id} className="mx-row">
                <Link
                  className="mx-pick mx-row-main"
                  href={`/support/${guild}/${ticket.id}`}
                  style={{ textDecoration: 'none' }}
                >
                  <span className="mx-row-title mx-ellipsis">
                    {ticket.subject ?? t('Ticket {number}', { number: String(ticket.number) })}
                  </span>
                  <span className="mx-sub">
                    {[ticket.panel, date(t, ticket.createdAt, 'UTC')].join(', ')}
                  </span>
                </Link>
                <span className="mx-chip">{ticket.open ? t('Open') : t('Closed')}</span>
              </div>
            ))}
          </section>
        ) : null}
      </main>
    </div>
  );
}
