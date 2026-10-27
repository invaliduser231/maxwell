import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/site';
import { ModuleIcon } from '@/components/ui';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { inviteUrl } from '@/lib/fluxer';
import type { Key } from '@/lib/i18n';
import { getT } from '@/lib/i18n/server';
import { allPages, POLE_COLOR, pageByKey } from '@/lib/pages';
import { LandingChat } from './landing-chat';
import { Reveal } from './reveal';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { absolute: 'Maxwell' },
    description: t(
      'Moderation, logs, AutoMod, backups, welcome cards and levels for Fluxer communities.',
    ),
  };
}

const features: { key: string; text: Key }[] = [
  {
    key: 'moderation',
    text: 'Every warn, timeout, kick and ban becomes a numbered case. m!case 42 shows it, m!reason 42 corrects the reason, and the member can get a DM with it.',
  },
  {
    key: 'automod',
    text: 'Fluxer has no built-in AutoMod. Maxwell filters spam, invite links, mass mentions and word lists. A new rule can run in log-only mode first.',
  },
  {
    key: 'security',
    text: 'Verification with a captcha, raid and nuke protection, and a risk score for new accounts.',
  },
  {
    key: 'logs',
    text: 'Deleted and edited messages with the old text, joins, leaves and changes to roles and channels.',
  },
  {
    key: 'backups',
    text: 'Roles, channels and permissions are saved every day. Restore them from the dashboard, or build a server from a Discord template.',
  },
  {
    key: 'tickets',
    text: 'Ticket panels, modmail by direct message and a transcript when a ticket closes.',
  },
  {
    key: 'welcome',
    text: 'A message and a card for new members, roles on join and a goodbye card when someone leaves.',
  },
  {
    key: 'invites',
    text: 'Which invite each member used and who created it. The join log flags new accounts.',
  },
  {
    key: 'levels',
    text: 'XP for messages and roles at the levels you set. m!rank and m!levels show the cards below.',
  },
];

const notListed = new Set([
  'overview',
  'members',
  'cards',
  'general',
  'access',
  'audit',
  ...features.map((feature) => feature.key),
]);

async function communityCount(): Promise<number> {
  try {
    const [row] = await db().sql<{ n: number }[]>`
      select count(*)::int as n from guilds where left_at is null
    `;
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

export default async function Landing() {
  const [t, count] = await Promise.all([getT(), communityCount()]);
  const invite = inviteUrl();
  const source = env().SOURCE_URL;
  const more = allPages.filter((page) => !notListed.has(page.key)).map((page) => t(page.name));

  return (
    <div className="mx-land">
      <div className="mx-land-top">
        <SiteHeader sections />

        <section className="mx-land-wrap mx-land-hero">
          <svg
            className="mx-land-field"
            width="980"
            height="760"
            viewBox="0 0 980 760"
            aria-hidden="true"
          >
            <g fill="none" stroke="#F26B3A" strokeWidth="3">
              <path d="M310 800V420a180 180 0 0 1 360 0v380" strokeOpacity=".42" />
              <path d="M250 800V420a240 240 0 0 1 480 0v380" strokeOpacity=".28" />
              <path d="M185 800V420a305 305 0 0 1 610 0v380" strokeOpacity=".18" />
              <path d="M115 800V420a375 375 0 0 1 750 0v380" strokeOpacity=".11" />
              <path d="M40 800V420a450 450 0 0 1 900 0v380" strokeOpacity=".06" />
            </g>
            <g fill="none" stroke="#F26B3A" strokeWidth="3" strokeLinecap="round">
              <path
                className="mx-land-flow"
                d="M310 800V420a180 180 0 0 1 360 0v380"
                strokeOpacity=".55"
              />
              <path
                className="mx-land-flow"
                d="M185 800V420a305 305 0 0 1 610 0v380"
                strokeOpacity=".3"
                style={{ animationDuration: '52s' }}
              />
            </g>
          </svg>

          <div className="mx-land-pitch">
            <h1 className="mx-land-title">{t('Maxwell keeps your Fluxer community sorted.')}</h1>
            <p className="mx-land-lead">
              {t(
                'Moderation, logs, AutoMod, welcome cards, levels and backups for Fluxer. Settings live in a web dashboard, so in chat you only type things like m!ban or m!rank.',
              )}
            </p>
            <div className="mx-land-actions">
              {invite ? (
                <a href={invite} className="mx-land-btn mx-land-btn-primary">
                  {t('Invite Maxwell to Fluxer')}
                </a>
              ) : null}
              <Link href="/communities" className="mx-land-btn">
                {t('Open the dashboard')}
              </Link>
            </div>
            {count > 0 ? (
              <p style={{ margin: 0, fontSize: 14, color: 'var(--mx-muted)' }}>
                {t.plural(count, 'Running in {n} community.', 'Running in {n} communities.')}
              </p>
            ) : null}
          </div>

          <LandingChat />
        </section>
      </div>

      <section id="modules" className="mx-land-band">
        <div className="mx-land-wrap mx-land-section">
          <Reveal className="mx-land-intro">
            <h2 className="mx-land-h2">{t('What it does')}</h2>
            <p className="mx-land-sub">
              {t(
                'Changes in the dashboard go into an audit trail, and most of them can be undone.',
              )}
            </p>
          </Reveal>
          <div className="mx-land-features">
            {features.map((feature, index) => {
              const page = pageByKey(feature.key);
              if (!page) return null;
              return (
                <Reveal key={feature.key} delay={(index % 3) * 90} className="mx-land-feature">
                  <ModuleIcon d={page.icon} fill={POLE_COLOR[page.pole]} size={44} className="" />
                  <h3>{t(page.name)}</h3>
                  <p>{t(feature.text)}</p>
                </Reveal>
              );
            })}
          </div>
          <Reveal>
            <p className="mx-land-sub" style={{ maxWidth: 760 }}>
              {t('Also in the dashboard: {list}.', { list: t.list(more) })}
            </p>
          </Reveal>
        </div>
      </section>

      <section id="cards" className="mx-land-wrap mx-land-section">
        <Reveal className="mx-land-intro">
          <h2 className="mx-land-h2">{t('Welcome and level cards')}</h2>
          <p className="mx-land-sub">{t('In your colors, or on your own background.')}</p>
        </Reveal>
        <div className="mx-land-cards">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
            <Reveal>
              <img
                src="/landing/welcome.png"
                width={1000}
                height={420}
                alt={t('Welcome card for Lena, member 1,204')}
              />
            </Reveal>
            <Reveal>
              <img
                src="/landing/rank.png"
                width={1000}
                height={300}
                alt={t('Rank card with level and rank')}
              />
            </Reveal>
            <Reveal>
              <img src="/landing/levelup.png" width={1000} height={300} alt={t('Level up card')} />
            </Reveal>
          </div>
          <Reveal delay={120}>
            <img
              src="/landing/leaderboard.png"
              width={1000}
              height={1024}
              alt={t('Leaderboard card with ten members')}
            />
          </Reveal>
        </div>
      </section>

      <section className="mx-land-band">
        <Reveal className="mx-land-wrap mx-land-closing">
          {source ? (
            <div className="mx-land-intro" style={{ alignItems: 'center' }}>
              <h2 className="mx-land-h2">{t('Free and open source')}</h2>
              <p className="mx-land-sub">{t('Use the hosted bot or run your own.')}</p>
            </div>
          ) : null}
          <div className="mx-land-actions" style={{ justifyContent: 'center' }}>
            {invite ? (
              <a href={invite} className="mx-land-btn mx-land-btn-primary mx-land-btn-big">
                {t('Invite Maxwell to Fluxer')}
              </a>
            ) : null}
            {source ? (
              <a href={source} className="mx-land-btn mx-land-btn-big">
                {t('Read the source')}
              </a>
            ) : (
              <Link href="/communities" className="mx-land-btn mx-land-btn-big">
                {t('Open the dashboard')}
              </Link>
            )}
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </div>
  );
}
