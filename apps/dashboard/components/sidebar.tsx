'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { openCount } from '@/app/g/[guild]/inbox/actions';
import { lockedCount, type PageGroup, POLE_COLOR } from '@/lib/pages';
import { CommunitySwitcher, type SwitcherCommunity } from './community-switcher';
import { useT } from './i18n';
import { useLive } from './live';
import { SettingsSearch } from './settings-search';
import { LockIcon, ModuleIcon } from './ui';

export interface SidebarProps {
  guildId: string;
  guildName: string;
  guildIcon: string | null;
  memberCount: number | null;
  groups: PageGroup[];
  voted: boolean;
  voteUrl: string | null;
  others: SwitcherCommunity[];
  inboxCount: number | null;
}

export function Sidebar(props: SidebarProps) {
  const pathname = usePathname();
  const t = useT();
  const base = `/g/${props.guildId}`;
  const active =
    pathname === base ? 'overview' : (pathname.slice(base.length + 1).split('/')[0] ?? '');
  const [inbox, setInbox] = useState(props.inboxCount);
  const [query, setQuery] = useState('');
  const searching = query.trim().length >= 2;
  useLive(['moderation'], () => {
    if (props.inboxCount === null) return;
    openCount(props.guildId)
      .then((result) => {
        if (result.ok && result.data !== undefined) setInbox(result.data);
      })
      .catch(() => {});
  });

  return (
    <nav
      className="mx-side-nav"
      aria-label={t('Dashboard')}
      style={{
        width: '100%',
        padding: '14px 10px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        position: 'sticky',
        top: 'var(--mx-topbar)',
        maxHeight: 'calc(100vh - var(--mx-topbar))',
        overflowY: 'auto',
      }}
    >
      <CommunitySwitcher
        current={{
          id: props.guildId,
          name: props.guildName,
          iconUrl: props.guildIcon,
          members: props.memberCount,
        }}
        others={props.others}
      />

      <SettingsSearch
        base={base}
        pages={props.groups.flatMap((group) => group.pages)}
        query={query}
        setQuery={setQuery}
      />

      <div style={{ display: searching ? 'none' : 'flex', flexDirection: 'column' }}>
        {props.groups.map((group) => (
          <div key={group.title || 'top'} style={{ display: 'flex', flexDirection: 'column' }}>
            {group.title ? <span className="mx-nav-group">{t(group.title)}</span> : null}
            {group.pages.map((page) => (
              <Link
                key={page.key}
                className="mx-nav-item"
                style={{ '--pole': POLE_COLOR[page.pole] } as React.CSSProperties}
                href={page.key === 'overview' ? base : `${base}/${page.key}`}
                aria-current={page.key === active ? 'page' : undefined}
              >
                <ModuleIcon d={page.icon} fill="var(--pole)" size={22} />
                <span style={{ flex: 1, minWidth: 0 }}>{t(page.name)}</span>
                {page.key === 'inbox' && inbox ? (
                  <span className="mx-nav-count">{t.count(inbox)}</span>
                ) : null}
                {page.locked && !props.voted ? (
                  <LockIcon label={t('Locked until you vote')} />
                ) : null}
              </Link>
            ))}
          </div>
        ))}
      </div>

      {!props.voted && props.voteUrl ? (
        <a
          href={props.voteUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            textDecoration: 'none',
            background: 'var(--mx-panel)',
            borderRadius: 10,
            padding: '9px 11px',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--mx-north)' }}>
            {t('Vote on fluxerlist')}
          </span>
          <span style={{ fontSize: 12, color: 'var(--mx-muted)' }}>
            {t('Unlocks {count} modules for you', { count: lockedCount })}
          </span>
        </a>
      ) : null}
    </nav>
  );
}
