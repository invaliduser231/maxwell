'use client';

import { useState, useTransition } from 'react';
import { useT } from '@/components/i18n';
import { failed, StatusText } from '@/components/status-text';
import { sendDispute } from './actions';

const MIN = 20;
const MAX = 2_000;

export function DisputeForm() {
  const t = useT();
  const [body, setBody] = useState('');
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const short = body.trim().length < MIN;

  return (
    <form
      className="mx-stack"
      style={{ width: '100%', gap: 12, textAlign: 'left' }}
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (short) return;
        start(async () => {
          const result = await sendDispute(body);
          if (!result.ok) setError(result.error);
        });
      }}
    >
      <label className="mx-field">
        <span className="mx-label">{t('Why should the listing be removed?')}</span>
        <textarea
          className="mx-textarea"
          rows={7}
          value={body}
          maxLength={MAX}
          aria-invalid={tried && short ? true : undefined}
          onChange={(event) => setBody(event.target.value)}
        />
        {tried && short ? (
          <span className="mx-field-error">{t('Write at least 20 characters.')}</span>
        ) : (
          <span className="mx-sub">
            {t('The operators of Maxwell see your name and this text.')}
          </span>
        )}
      </label>
      <div className="mx-inline" style={{ justifyContent: 'flex-end' }}>
        <StatusText status={error ? failed(error) : null} />
        <button type="submit" className="mx-btn mx-btn-primary" disabled={pending}>
          {t('Send dispute')}
        </button>
      </div>
    </form>
  );
}
