'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from './i18n';

export interface SwitcherCommunity {
  id: string;
  name: string;
  iconUrl: string | null;
  members: number | null;
  invite?: string | null;
}

const SEARCH_FROM = 5;

const tints = ['#3A3A6E', '#2D5A44', '#6E3A3A', '#3A556E', '#4A4A55', '#6E5A3A'];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function tint(id: string): string {
  return tints[Number(BigInt(id) % BigInt(tints.length))] ?? '#3A3A6E';
}

function GuildIcon({ community, size }: { community: SwitcherCommunity; size: number }) {
  if (community.iconUrl) {
    return (
      <img
        src={community.iconUrl}
        alt=""
        width={size}
        height={size}
        style={{ borderRadius: size * 0.28, flexShrink: 0, display: 'block' }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: tint(community.id),
        fontWeight: 600,
        fontSize: Math.round(size * 0.43),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {initials(community.name)}
    </span>
  );
}

export function CommunitySwitcher({
  current,
  others,
}: {
  current: SwitcherCommunity;
  others: SwitcherCommunity[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const pathname = usePathname();
  const section = pathname.split('/').slice(3).join('/');

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }

  const needle = query.trim().toLowerCase();
  const list = others.filter((entry) => !needle || entry.name.toLowerCase().includes(needle));
  const joined = list.filter((entry) => !entry.invite);
  const invitable = list.filter((entry) => entry.invite);

  return (
    <div ref={root} style={{ position: 'relative' }}>
      <button
        ref={button}
        type="button"
        className="mx-switcher"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t('Switch community, current: {name}', { name: current.name })}
        onClick={() => setOpen((value) => !value)}
      >
        <GuildIcon community={current} size={28} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            lineHeight: 1.25,
          }}
        >
          <span className="mx-ellipsis" style={{ fontWeight: 600, fontSize: 13 }}>
            {current.name}
          </span>
          {current.members !== null ? (
            <span style={{ fontSize: 11, color: 'var(--mx-muted)' }}>
              {t.plural(current.members, '{n} member', '{n} members')}
            </span>
          ) : null}
        </span>
        <svg
          className="mx-switcher-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            d="M7 10l5-5 5 5M7 14l5 5 5-5"
            fill="none"
            stroke="#9A9EA6"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div id={menuId} role="menu" aria-label={t('Communities')} className="mx-popover">
          {others.length >= SEARCH_FROM ? (
            <input
              className="mx-input"
              type="search"
              placeholder={t('Search')}
              aria-label={t('Search communities')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              style={{ minHeight: 32, padding: '6px 9px', fontSize: 13 }}
            />
          ) : null}
          <div
            style={{ display: 'flex', flexDirection: 'column', maxHeight: 320, overflowY: 'auto' }}
          >
            <span aria-current="true" className="mx-popover-item mx-popover-current">
              <GuildIcon community={current} size={24} />
              <span className="mx-ellipsis" style={{ flex: 1 }}>
                {current.name}
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M5 12.5l4.5 4.5L19 7.5"
                  fill="none"
                  stroke="var(--mx-north)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            {joined.map((entry) => (
              <Link
                key={entry.id}
                role="menuitem"
                className="mx-popover-item"
                href={`/g/${entry.id}${section ? `/${section}` : ''}`}
              >
                <GuildIcon community={entry} size={24} />
                <span className="mx-ellipsis" style={{ flex: 1 }}>
                  {entry.name}
                </span>
              </Link>
            ))}
            {invitable.length > 0 ? (
              <span className="mx-sub" style={{ padding: '10px 9px 4px' }}>
                {t('Without Maxwell')}
              </span>
            ) : null}
            {invitable.map((entry) => (
              <a
                key={entry.id}
                role="menuitem"
                className="mx-popover-item"
                href={entry.invite ?? '#'}
              >
                <GuildIcon community={entry} size={24} />
                <span className="mx-ellipsis" style={{ flex: 1, color: 'var(--mx-muted)' }}>
                  {entry.name}
                </span>
                <span className="mx-sub">{t('Invite')}</span>
              </a>
            ))}
            {needle && list.length === 0 ? (
              <span className="mx-sub" style={{ padding: '8px 9px' }}>
                {t('No community called "{name}".', { name: query.trim() })}
              </span>
            ) : null}
          </div>
          <Link role="menuitem" className="mx-popover-item mx-popover-footer" href="/communities">
            {t('All communities')}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
