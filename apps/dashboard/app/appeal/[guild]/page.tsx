import { TopBar } from '@/components/top-bar';
import { Avatar } from '@/components/ui';
import { requireUser } from '@/lib/access';
import { getT, titled } from '@/lib/i18n/server';
import { date } from '@/lib/time';
import { AppealForm } from './appeal-form';
import { appealState } from './data';

export const generateMetadata = titled('Appeal a ban');

export default async function AppealPage({ params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const user = await requireUser(`/appeal/${guild}`);
  const [state, t] = await Promise.all([appealState(guild, user.id), getT()]);

  let body: React.ReactNode;
  switch (state.kind) {
    case 'closed':
      body = <p className="mx-sub">{t('This community does not take appeals here.')}</p>;
      break;
    case 'not-banned':
      body = (
        <p className="mx-sub">
          {t('You are not banned in {server}.', { server: state.guild.name })}
        </p>
      );
      break;
    case 'open':
      body = (
        <>
          <p style={{ margin: 0 }}>{t('Your appeal is with the moderators.')}</p>
          <p className="mx-sub" style={{ margin: 0 }}>
            {t('You get a direct message when they decide.')}
          </p>
        </>
      );
      break;
    case 'wait':
      body = (
        <>
          <p style={{ margin: 0 }}>
            {state.appeal.status === 'resolved'
              ? t('Your appeal was accepted.')
              : t('Your appeal was declined.')}
          </p>
          {state.appeal.status === 'resolved' ? null : (
            <p className="mx-sub" style={{ margin: 0 }}>
              {t('You can appeal again on {date}.', { date: date(t, state.until, 'UTC') })}
            </p>
          )}
        </>
      );
      break;
    case 'ready':
      body = <AppealForm guildId={guild} />;
      break;
  }

  const name = state.kind === 'closed' ? null : state.guild;

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
            maxWidth: 520,
            padding: '24px 22px 22px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
            textAlign: 'center',
          }}
        >
          {name ? <Avatar src={name.iconUrl} name={name.name} size={56} /> : null}
          <div className="mx-stack" style={{ gap: 4, alignItems: 'center' }}>
            <h1 className="mx-h1">{t('Appeal a ban')}</h1>
            {name ? <span className="mx-sub">{name.name}</span> : null}
          </div>
          {body}
        </div>
      </main>
    </div>
  );
}
