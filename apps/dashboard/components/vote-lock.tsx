'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { checkVote } from '@/lib/actions';
import { lockedCount } from '@/lib/pages';
import { useGuild } from './guild';
import { useT } from './i18n';

export function VoteLock({ module }: { module: string }) {
  const { voteUrl } = useGuild();
  const t = useT();
  const router = useRouter();
  const [label, setLabel] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const check = () =>
    start(async () => {
      const result = await checkVote();
      if (result.ok && result.data?.voted) {
        router.refresh();
        return;
      }
      setLabel(result.ok ? t('No vote found yet') : t.raw(result.error));
    });

  return (
    <div
      role="dialog"
      aria-labelledby="vote-title"
      style={{
        width: '100%',
        maxWidth: 440,
        background: 'var(--mx-raised)',
        borderRadius: 14,
        padding: '22px 22px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        textAlign: 'center',
      }}
    >
      <img src="/mascot/thinking.svg" alt="" width={64} height={64} style={{ display: 'block' }} />
      <h2 id="vote-title" style={{ margin: 0, fontFamily: 'var(--mx-display)', fontSize: 20 }}>
        {t('{module} opens with a vote', { module })}
      </h2>
      <p style={{ margin: 0, color: 'var(--mx-text-2)', lineHeight: 1.5 }}>
        {t('One vote on fluxerlist unlocks {module} and {count} more modules.', {
          module,
          count: lockedCount - 1,
        })}
      </p>
      <div className="mx-inline" style={{ justifyContent: 'center', paddingTop: 4 }}>
        {voteUrl ? (
          <a className="mx-btn mx-btn-primary" href={voteUrl} target="_blank" rel="noreferrer">
            {t('Vote on fluxerlist')}
          </a>
        ) : null}
        <button type="button" className="mx-btn" disabled={pending} onClick={check}>
          {label ?? t('I voted, check again')}
        </button>
      </div>
    </div>
  );
}
