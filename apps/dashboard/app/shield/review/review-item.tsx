'use client';

import { useState, useTransition } from 'react';
import { useT } from '@/components/i18n';
import { failed, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import { decideDispute } from './actions';

const NOTE_MAX = 500;

export function ReviewActions({ id }: { id: string }) {
  const t = useT();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (action: 'remove' | 'keep') => {
    if (action === 'keep' && note.trim().length === 0) {
      setError('Write a short note for the user.');
      return;
    }
    setError(null);
    start(async () => {
      const result = await decideDispute({ id, action, note });
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div className="mx-stack" style={{ gap: 10 }}>
      <label className="mx-field">
        <span className="mx-label">{t('Note for the user')}</span>
        <textarea
          className="mx-textarea"
          rows={2}
          value={note}
          maxLength={NOTE_MAX}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="mx-inline" style={{ justifyContent: 'flex-end' }}>
        <StatusText status={error ? failed(error) : null} />
        <button type="button" className="mx-btn" disabled={pending} onClick={() => run('keep')}>
          {t('Keep listing')}
        </button>
        <TwoStep label={t('Remove listing')} danger disabled={pending} run={() => run('remove')} />
      </div>
    </div>
  );
}
