'use client';

import { useTransition } from 'react';
import { setLanguage } from '@/lib/actions';
import { useT } from './i18n';

export function LanguageSwitch() {
  const t = useT();
  const [pending, start] = useTransition();
  const next = t.lang === 'de' ? 'en' : 'de';
  return (
    <button
      type="button"
      className="mx-btn mx-btn-ghost"
      style={{ fontSize: 12, minHeight: 28, padding: '4px 8px' }}
      disabled={pending}
      lang={next}
      title={next === 'de' ? 'Deutsch' : 'English'}
      aria-label={next === 'de' ? 'Auf Deutsch umschalten' : 'Switch to English'}
      onClick={() => start(() => setLanguage(next))}
    >
      {next.toUpperCase()}
    </button>
  );
}
