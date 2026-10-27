import Link from 'next/link';
import { AccountMenu } from './account-menu';
import { Logo } from './ui';

export function TopBar({
  user,
  overlay = false,
}: {
  user?: { name: string; avatarUrl: string } | null;
  overlay?: boolean;
}) {
  return (
    <header
      className="mx-between mx-topbar"
      style={{
        gap: 12,
        ...(overlay ? { position: 'absolute', left: 0, right: 0, zIndex: 2 } : {}),
      }}
    >
      <Link
        href={user ? '/communities' : '/'}
        style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}
      >
        <Logo />
        <span style={{ fontFamily: 'var(--mx-display)', fontWeight: 700, fontSize: 17 }}>
          Maxwell
        </span>
      </Link>
      <AccountMenu user={user ?? null} />
    </header>
  );
}
