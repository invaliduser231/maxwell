'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { logout, setLanguage } from '@/lib/actions';
import { useT } from './i18n';
import { Avatar } from './ui';

const languages = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
] as const;

export function AccountMenu({ user }: { user: { name: string; avatarUrl: string } | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

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

  return (
    <div ref={root} className="mx-account-wrap">
      <button
        ref={button}
        type="button"
        className="mx-account"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={user ? t('Account menu') : t('Language')}
        onClick={() => setOpen((value) => !value)}
      >
        {user ? (
          <>
            <Avatar src={user.avatarUrl} name={user.name} size={24} />
            <span className="mx-ellipsis mx-account-name">{user.name}</span>
          </>
        ) : (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              />
            </svg>
            <span className="mx-account-name">{t.lang.toUpperCase()}</span>
          </>
        )}
        <svg
          className="mx-switcher-chevron"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            d="M6 9l6 6 6-6"
            fill="none"
            stroke="#9A9EA6"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div id={menuId} role="menu" className="mx-popover mx-account-menu">
          {user ? (
            <div className="mx-account-head">
              <Avatar src={user.avatarUrl} name={user.name} size={36} />
              <span className="mx-ellipsis" style={{ fontWeight: 600, fontSize: 14 }}>
                {user.name}
              </span>
            </div>
          ) : null}
          <span className="mx-sub" style={{ padding: '4px 4px 0' }}>
            {t('Language')}
          </span>
          <div className="mx-lang" role="group" aria-label={t('Language')}>
            {languages.map((language) => (
              <button
                key={language.code}
                type="button"
                role="menuitemradio"
                lang={language.code}
                aria-checked={t.lang === language.code}
                disabled={pending}
                onClick={() => {
                  if (t.lang !== language.code) start(() => setLanguage(language.code));
                }}
              >
                {language.label}
              </button>
            ))}
          </div>
          {user ? (
            <form action={logout} className="mx-account-foot">
              <button type="submit" role="menuitem" className="mx-popover-item mx-account-out">
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {t('Log out')}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
