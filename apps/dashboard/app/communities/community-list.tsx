'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useT } from '@/components/i18n';
import type { CommunityEntry as Community } from '@/lib/communities';

export type { Community };

const filters = [
  { key: 'all', name: 'All' },
  { key: 'in', name: 'With Maxwell' },
  { key: 'out', name: 'Without' },
] as const;

const tints = ['#3A3A6E', '#2D5A44', '#6E3A3A', '#3A556E', '#4A4A55', '#6E5A3A'];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function CommunityList({ communities }: { communities: Community[] }) {
  const t = useT();
  const [filter, setFilter] = useState<(typeof filters)[number]['key']>('all');
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const list = communities
    .filter((entry) => filter === 'all' || entry.status === filter)
    .filter((entry) => !needle || entry.name.toLowerCase().includes(needle));

  return (
    <>
      <div className="mx-between">
        <h1 className="mx-h1">{t('Choose a community')}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="mx-seg" role="group" aria-label={t('Show')}>
            {filters.map((entry) => (
              <button
                key={entry.key}
                type="button"
                aria-pressed={filter === entry.key}
                onClick={() => setFilter(entry.key)}
              >
                {t(entry.name)}
              </button>
            ))}
          </div>
          <input
            className="mx-input"
            type="search"
            aria-label={t('Search communities')}
            placeholder={t('Search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ width: 200 }}
          />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
          gap: 12,
        }}
      >
        {list.map((entry, index) => (
          <div
            key={entry.id}
            className="mx-panel"
            style={{
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              {entry.iconUrl ? (
                <img
                  src={entry.iconUrl}
                  alt=""
                  width={38}
                  height={38}
                  style={{ borderRadius: 10, flexShrink: 0 }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: tints[index % tints.length],
                    fontWeight: 600,
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {initials(entry.name)}
                </span>
              )}
              <div className="mx-row-main">
                <span className="mx-row-title mx-ellipsis">{entry.name}</span>
                {entry.members !== null ? (
                  <span className="mx-sub">
                    {t('{n, plural, one {# member} other {# members}}', { n: entry.members })}
                  </span>
                ) : null}
              </div>
            </div>
            {entry.status === 'in' ? (
              <Link
                className="mx-btn mx-btn-primary"
                href={`/g/${entry.id}`}
                style={{ justifyContent: 'center' }}
              >
                {t('Open dashboard')}
              </Link>
            ) : null}
            {entry.status === 'out' && entry.invite ? (
              <a className="mx-btn" href={entry.invite} style={{ justifyContent: 'center' }}>
                {t('Invite Maxwell')}
              </a>
            ) : null}
          </div>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="mx-panel mx-empty">
          {needle
            ? t('No community called "{name}".', { name: query.trim() })
            : t('No communities here.')}
        </div>
      ) : null}
    </>
  );
}
