import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteFooter, SiteHeader } from '@/components/site';
import { Avatar } from '@/components/ui';
import { getT } from '@/lib/i18n/server';
import { FORMER_MEMBER } from '@/lib/people';
import { longDate } from '@/lib/time';
import { publicPage } from './data';
import './public.css';

type Props = { params: Promise<{ guild: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { guild } = await params;
  const [page, t] = await Promise.all([publicPage(guild), getT()]);
  if (!page) return {};
  const description = page.description || t('{name} on Fluxer.', { name: page.name });
  return {
    title: { absolute: page.name },
    description,
    openGraph: {
      title: page.name,
      description,
      images: page.iconUrl ? [{ url: page.iconUrl, width: 128, height: 128 }] : undefined,
    },
  };
}

export default async function PublicCommunity({ params }: Props) {
  const { guild } = await params;
  const [page, t] = await Promise.all([publicPage(guild), getT()]);
  if (!page) notFound();

  return (
    <div className="mx-land">
      <SiteHeader />

      <section className="mx-land-wrap mx-pub-hero">
        {page.iconUrl ? (
          <img className="mx-pub-icon" src={page.iconUrl} alt="" width={96} height={96} />
        ) : (
          <span className="mx-pub-icon mx-pub-initial" aria-hidden="true">
            {page.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="mx-pub-head">
          <h1 className="mx-pub-title">{page.name}</h1>
          {page.memberCount !== null ? (
            <p className="mx-pub-count">
              {t.plural(page.memberCount, '{n} member', '{n} members')}
            </p>
          ) : null}
        </div>
        {page.description ? <p className="mx-pub-about">{page.description}</p> : null}
        {page.invite ? (
          <div className="mx-land-actions">
            <a href={page.invite} className="mx-land-btn mx-land-btn-primary" rel="nofollow">
              {t('Join on Fluxer')}
            </a>
          </div>
        ) : null}
      </section>

      {page.leaderboard || page.events ? (
        <section className="mx-land-band">
          <div className="mx-land-wrap mx-pub-sections">
            {page.leaderboard ? (
              <div className="mx-pub-block">
                <h2 className="mx-pub-h2">{t('Leaderboard')}</h2>
                {page.leaderboard.length > 0 ? (
                  <ol className="mx-pub-board">
                    {page.leaderboard.map((member) => {
                      const name = member.name ?? t(FORMER_MEMBER);
                      return (
                        <li key={member.userId} className="mx-pub-member">
                          <span className="mx-pub-rank">{member.rank}</span>
                          <Avatar src={member.avatar} name={name} size={36} />
                          <span className="mx-pub-name">{name}</span>
                          <span className="mx-pub-score">
                            <span>{t('Level {level}', { level: member.level })}</span>
                            <span className="mx-pub-xp">{`${t.count(member.xp)} XP`}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="mx-pub-empty">{t('Nobody has XP yet.')}</p>
                )}
              </div>
            ) : null}

            {page.events ? (
              <div className="mx-pub-block">
                <h2 className="mx-pub-h2">{t('Upcoming events')}</h2>
                {page.events.length > 0 ? (
                  <ul className="mx-pub-events">
                    {page.events.map((event) => (
                      <li key={event.id} className="mx-pub-event">
                        <span className="mx-pub-when">
                          {longDate(t, event.startsAt, event.timezone)}
                        </span>
                        <span className="mx-pub-event-title">{event.title}</span>
                        <span className="mx-pub-where">
                          {event.location ? `${event.location}, ${event.timezone}` : event.timezone}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mx-pub-empty">{t('No events planned.')}</p>
                )}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <SiteFooter />
    </div>
  );
}
