import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteFooter, SiteHeader } from '@/components/site';
import { roleColor } from '@/components/ui';
import { getT } from '@/lib/i18n/server';
import { getSession } from '@/lib/session';
import type { PreviewChannel } from '@/lib/template-view';
import { mayRemove, templateDetail, templateTargets } from '@/lib/templates';
import '../templates.css';
import { ChannelIcon, RemoveTemplate, UseTemplate } from './template-actions';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const detail = await templateDetail(id);
  if (!detail) return {};
  return {
    title: detail.card.title,
    description: detail.card.description || undefined,
  };
}

function Channel({ channel, label }: { channel: PreviewChannel; label: string }) {
  return (
    <li className="mx-tpl-channel">
      <ChannelIcon type={channel.type} hidden={channel.hidden} label={label} />
      <span className="mx-tpl-channel-name">{channel.name}</span>
      {channel.nsfw ? <span className="mx-tpl-flag">NSFW</span> : null}
    </li>
  );
}

export default async function TemplatePage({ params }: Props) {
  const { id } = await params;
  const [detail, t, session] = await Promise.all([templateDetail(id), getT(), getSession()]);
  if (!detail) notFound();
  const { card, preview } = detail;
  const [targets, removable] = session
    ? await Promise.all([templateTargets(session.user), mayRemove(session.user, detail.guildId)])
    : [null, false];
  const privateLabel = t('Hidden from @everyone');

  return (
    <div className="mx-land">
      <SiteHeader />

      <section className="mx-land-wrap mx-tpl-hero">
        <Link href="/templates" className="mx-tpl-back">
          {t('All templates')}
        </Link>
        <h1 className="mx-tpl-title">{card.title}</h1>
        {card.guildName ? (
          <p className="mx-tpl-from">{t('From {name}', { name: card.guildName })}</p>
        ) : null}
        {card.description ? <p className="mx-tpl-lead">{card.description}</p> : null}
        <p className="mx-tpl-meta">
          {[
            t('{n, plural, one {# role} other {# roles}}', { n: card.roleCount }),
            t('{n, plural, one {# channel} other {# channels}}', { n: card.channelCount }),
            t('{n, plural, one {Used # time} other {Used # times}}', { n: card.uses }),
          ].join(', ')}
        </p>
        <div className="mx-tpl-use">
          {targets ? (
            <UseTemplate templateId={card.id} targets={targets} />
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(`/templates/${card.id}`)}`}
              className="mx-land-btn mx-land-btn-primary"
            >
              {t('Use this template')}
            </Link>
          )}
          {removable ? <RemoveTemplate templateId={card.id} /> : null}
        </div>
      </section>

      <section className="mx-land-band">
        <div className="mx-land-wrap mx-tpl-preview">
          <div className="mx-tpl-block">
            <h2 className="mx-tpl-h2">{t('Roles')}</h2>
            {preview.roles.length > 0 ? (
              <ul className="mx-tpl-list">
                {preview.roles.map((role) => (
                  <li key={role.key} className="mx-tpl-role">
                    <span
                      className="mx-tpl-dot"
                      style={{ background: roleColor(role.color) }}
                      aria-hidden="true"
                    />
                    <span className="mx-tpl-channel-name">{role.name}</span>
                    {role.hoist ? (
                      <span className="mx-tpl-flag">{t('Shown separately')}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mx-tpl-empty">{t('No roles.')}</p>
            )}
          </div>

          <div className="mx-tpl-block">
            <h2 className="mx-tpl-h2">{t('Channels')}</h2>
            {preview.groups.length > 0 ? (
              <div className="mx-tpl-list">
                {preview.groups.map((group) => (
                  <div key={group.key || 'loose'} className="mx-tpl-group">
                    {group.name ? (
                      <span className="mx-tpl-category">
                        {group.name}
                        {group.hidden ? (
                          <ChannelIcon type={-1} hidden label={privateLabel} />
                        ) : null}
                      </span>
                    ) : null}
                    {group.channels.length > 0 ? (
                      <ul className="mx-tpl-channels">
                        {group.channels.map((channel) => (
                          <Channel key={channel.key} channel={channel} label={privateLabel} />
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mx-tpl-empty">{t('No channels.')}</p>
            )}
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
