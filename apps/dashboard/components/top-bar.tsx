import Link from 'next/link';
import { logout } from '@/lib/actions';
import { Avatar, Logo } from './ui';

export function TopBar({
  user,
  overlay = false,
}: {
  user?: { name: string; avatarUrl: string } | null;
  overlay?: boolean;
}) {
  return (
    <header
      className="mx-between"
      style={{
        padding: '14px 24px',
        background: 'var(--mx-sunk)',
        gap: 12,
        ...(overlay ? { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2 } : {}),
      }}
    >
      <Link
        href="/"
        style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}
      >
        <Logo />
        <span style={{ fontFamily: 'var(--mx-display)', fontWeight: 700, fontSize: 17 }}>
          Maxwell
        </span>
      </Link>
      {user ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar src={user.avatarUrl} name={user.name} size={26} />
          <span style={{ fontWeight: 500 }}>{user.name}</span>
          <form action={logout}>
            <button type="submit" className="mx-btn mx-btn-ghost">
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </header>
  );
}
