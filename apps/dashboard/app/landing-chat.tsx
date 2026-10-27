'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/components/i18n';
import { Logo } from '@/components/ui';

const STEPS: [number, number][] = [
  [300, 1],
  [900, 2],
  [1900, 3],
  [2700, 4],
];

export function LandingChat() {
  const t = useT();
  const [step, setStep] = useState(9);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setStep(0);
    const timers = STEPS.map(([ms, next]) => setTimeout(() => setStep(next), ms));
    return () => timers.forEach(clearTimeout);
  }, []);

  const shown = (at: number) => (step >= at ? 'mx-land-step' : 'mx-land-step mx-land-later');

  return (
    <div className="mx-land-chat">
      <div className={shown(1)} style={{ fontSize: 13, color: 'var(--mx-muted)' }}>
        # general
      </div>
      <div className={shown(1)} style={{ display: 'flex', gap: 14 }}>
        <div className="mx-land-avatar" aria-hidden="true">
          L
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <div>
            <span style={{ fontWeight: 600 }}>Lena</span>{' '}
            <span style={{ color: 'var(--mx-muted)', fontSize: 13 }}>16:14</span>
          </div>
          <div style={{ fontFamily: 'var(--mx-mono)', fontSize: 14 }}>
            m!timeout @spammer 1h link spam
          </div>
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <div
          className="mx-land-step"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 54,
            top: 14,
            display: 'flex',
            gap: 5,
            opacity: step === 2 ? 1 : 0,
          }}
        >
          <span className="mx-land-dot" />
          <span className="mx-land-dot" style={{ animationDelay: '.15s' }} />
          <span className="mx-land-dot" style={{ animationDelay: '.3s' }} />
        </div>
        <div className={shown(3)} style={{ display: 'flex', gap: 14 }}>
          <Logo size={40} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <div>
              <span style={{ fontWeight: 600, color: 'var(--mx-north)' }}>Maxwell</span>{' '}
              <span className="mx-land-tag">{t('Bot')}</span>{' '}
              <span style={{ color: 'var(--mx-muted)', fontSize: 13 }}>16:14</span>
            </div>
            <div>
              <strong>spammer</strong> {t('is timed out for 1 hour. Case #42.')}
            </div>
          </div>
        </div>
      </div>
      <div className={shown(4)} style={{ fontSize: 13, color: 'var(--mx-muted)', paddingTop: 4 }}>
        # mod-log
      </div>
      <div className={shown(4)} style={{ display: 'flex', gap: 14 }}>
        <Logo size={40} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <span style={{ fontWeight: 600, color: 'var(--mx-north)' }}>Maxwell</span>{' '}
            <span style={{ color: 'var(--mx-muted)', fontSize: 13 }}>16:14</span>
          </div>
          <div className="mx-land-embed">
            <div style={{ fontWeight: 600 }}>{t('Case 42: Timeout')}</div>
            <div className="mx-land-fields">
              <Field label={t('Member')} value="@spammer" />
              <Field label={t('Moderator')} value="@Lena" />
              <Field label={t('Duration')} value={t('1 hour')} />
            </div>
            <Field label={t('Reason')} value="link spam" />
            <div style={{ fontSize: 12, color: 'var(--mx-muted)' }}>
              {t('User {id} / Case 42', { id: '1427883091557265408' })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14, minWidth: 0 }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span style={{ color: 'var(--mx-text-2)', overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}
