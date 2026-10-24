'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/lib/actions';
import { lockedCount, type PageGroup, POLE_COLOR } from '@/lib/pages';
import { CommunitySwitcher, type SwitcherCommunity } from './community-switcher';
import { Avatar, LockIcon, Logo, ModuleIcon } from './ui';

export interface SidebarProps {
  guildId: string;
  guildName: string;
  guildIcon: string | null;
  memberCount: number | null;
  groups: PageGroup[];
  voted: boolean;
  voteUrl: string | null;
  user: { name: string; avatarUrl: string };
  others: SwitcherCommunity[];
}

export function Sidebar(props: SidebarProps) {
  const pathname = usePathname();
  const base = `/g/${props.guildId}`;
  const active =
    pathname === base ? 'overview' : (pathname.slice(base.length + 1).split('/')[0] ?? '');

  return (
    <nav
      className="mx-side-nav"
      aria-label="Dashboard"
      style={{
        width: '100%',
        padding: '14px 10px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        position: 'sticky',
        top: 0,
        maxHeight: '100vh',
        overflowY: 'auto',
      }}
    >
      <Link
        href="/"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          textDecoration: 'none',
          padding: '2px 8px',
        }}
      >
        <Logo />
        <span style={{ fontFamily: 'var(--mx-display)', fontWeight: 700, fontSize: 17 }}>
          Maxwell
        </span>
      </Link>

      <CommunitySwitcher
        current={{
          id: props.guildId,
          name: props.guildName,
          iconUrl: props.guildIcon,
          members: props.memberCount,
        }}
        others={props.others}
      />

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {props.groups.map((group) => (
          <div key={group.title || 'top'} style={{ display: 'flex', flexDirection: 'column' }}>
            {group.title ? <span className="mx-nav-group">{group.title}</span> : null}
            {group.pages.map((page) => (
              <Link
                key={page.key}
                className="mx-nav-item"
                style={{ '--pole': POLE_COLOR[page.pole] } as React.CSSProperties}
                href={page.key === 'overview' ? base : `${base}/${page.key}`}
                aria-current={page.key === active ? 'page' : undefined}
              >
                <ModuleIcon d={page.icon} fill="var(--pole)" />
                <span style={{ flex: 1, minWidth: 0 }}>{page.name}</span>
                {page.locked && !props.voted ? <LockIcon /> : null}
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
            Vote on fluxerlist
          </span>
          <span style={{ fontSize: 12, color: 'var(--mx-muted)' }}>
            Unlocks {lockedCount} modules for you
          </span>
        </a>
      ) : null}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '8px 8px 0',
          borderTop: '1px solid var(--mx-line)',
        }}
      >
        <Avatar src={props.user.avatarUrl} name={props.user.name} size={26} />
        <span className="mx-ellipsis" style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
          {props.user.name}
        </span>
        <form action={logout}>
          <button
            type="submit"
            className="mx-btn mx-btn-ghost"
            style={{ fontSize: 12, minHeight: 28, padding: '4px 8px' }}
          >
            Log out
          </button>
        </form>
      </div>
    </nav>
  );
}
