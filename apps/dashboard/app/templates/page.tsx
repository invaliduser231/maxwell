import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/site';
import { getT, titled } from '@/lib/i18n/server';
import { templateCards } from '@/lib/templates';
import './templates.css';

export const generateMetadata = titled('Templates');

export default async function Templates({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort } = await searchParams;
  const order = sort === 'new' ? 'new' : 'popular';
  const [t, cards] = await Promise.all([getT(), templateCards(order)]);

  return (
    <div className="mx-land">
      <SiteHeader />

      <section className="mx-land-wrap mx-tpl-hero">
        <h1 className="mx-tpl-title">{t('Templates')}</h1>
        <p className="mx-tpl-lead">
          {t('Server setups that other communities have shared.')}
        </p>
      </section>

      <section className="mx-land-band">
        <div className="mx-land-wrap mx-tpl-body">
          <nav className="mx-tpl-sort" aria-label={t('Sort')}>
            <Link href="/templates" aria-current={order === 'popular' ? 'page' : undefined}>
              {t('Most used')}
            </Link>
            <Link href="/templates?sort=new" aria-current={order === 'new' ? 'page' : undefined}>
              {t('Newest')}
            </Link>
          </nav>
          {cards.length === 0 ? (
            <p className="mx-tpl-empty">{t('No templates yet.')}</p>
          ) : (
            <ul className="mx-tpl-grid">
              {cards.map((card) => (
                <li key={card.id} className="mx-tpl-card">
                  <Link href={`/templates/${card.id}`} className="mx-tpl-card-title">
                    {card.title}
                  </Link>
                  {card.guildName ? (
                    <span className="mx-tpl-from">
                      {t('From {name}', { name: card.guildName })}
                    </span>
                  ) : null}
                  {card.description ? <p className="mx-tpl-text">{card.description}</p> : null}
                  <span className="mx-tpl-meta">
                    {[
                      t.plural(card.roleCount, '{n} role', '{n} roles'),
                      t.plural(card.channelCount, '{n} channel', '{n} channels'),
                      t.plural(card.uses, 'Used {n} time', 'Used {n} times'),
                    ].join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
