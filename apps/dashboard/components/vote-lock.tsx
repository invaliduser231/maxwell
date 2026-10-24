'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { checkVote } from '@/lib/actions';
import { lockedCount } from '@/lib/pages';
import { useGuild } from './guild';

export function VoteLock({ module }: { module: string }) {
  const { voteUrl } = useGuild();
  const router = useRouter();
  const [label, setLabel] = useState('I voted, check again');
  const [pending, start] = useTransition();

  const check = () =>
    start(async () => {
      const result = await checkVote();
      if (result.ok && result.data?.voted) {
        router.refresh();
        return;
      }
      setLabel(result.ok ? 'No vote found yet' : result.error);
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
        {module} opens with a vote
      </h2>
      <p style={{ margin: 0, color: 'var(--mx-text-2)', lineHeight: 1.5 }}>
        Vote for Maxwell on fluxerlist once. {module} and the other {lockedCount - 1} locked modules
        stay open for you after that.
      </p>
      <div className="mx-inline" style={{ justifyContent: 'center', paddingTop: 4 }}>
        {voteUrl ? (
          <a className="mx-btn mx-btn-primary" href={voteUrl} target="_blank" rel="noreferrer">
            Vote on fluxerlist
          </a>
        ) : null}
        <button type="button" className="mx-btn" disabled={pending} onClick={check}>
          {label}
        </button>
      </div>
    </div>
  );
}
