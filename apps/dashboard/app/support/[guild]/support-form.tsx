'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Select } from '@/components/controls';
import { useT } from '@/components/i18n';
import { failed, type Status, StatusText } from '@/components/status-text';
import { sendTicket } from './actions';
import type { SupportPanel } from './data';

const MIN = 10;
const MAX = 2_000;

export function SupportForm({ guildId, panels }: { guildId: string; panels: SupportPanel[] }) {
  const t = useT();
  const router = useRouter();
  const [panelId, setPanelId] = useState(panels[0]?.id ?? '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [tried, setTried] = useState(false);
  const [status, setStatus] = useState<Status>(null);
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
          const result = await sendTicket(guildId, { panelId, subject, body });
          if (!result.ok) {
            setStatus(failed(result.error));
            return;
          }
          setStatus({ message: 'Your ticket is being opened.', error: false });
          setSubject('');
          setBody('');
          setTried(false);
          setTimeout(() => router.refresh(), 3_000);
        });
      }}
    >
      {panels.length > 1 ? (
        <div className="mx-field">
          <span className="mx-label">{t('Topic')}</span>
          <Select
            label={t('Topic')}
            value={panelId}
            options={panels.map((panel) => ({ value: panel.id, label: panel.name }))}
            onChange={setPanelId}
          />
        </div>
      ) : null}
      <label className="mx-field">
        <span className="mx-label">{t('Subject')}</span>
        <input
          className="mx-input"
          value={subject}
          maxLength={200}
          placeholder={t('Optional')}
          onChange={(event) => setSubject(event.target.value)}
        />
      </label>
      <label className="mx-field">
        <span className="mx-label">{t('Message')}</span>
        <textarea
          className="mx-textarea"
          rows={6}
          value={body}
          maxLength={MAX}
          aria-invalid={tried && short ? true : undefined}
          onChange={(event) => setBody(event.target.value)}
        />
        {tried && short ? (
          <span className="mx-field-error">{t('Write at least 10 characters.')}</span>
        ) : null}
      </label>
      <div className="mx-inline" style={{ justifyContent: 'flex-end' }}>
        <StatusText status={status} />
        <button type="submit" className="mx-btn mx-btn-primary" disabled={pending}>
          {t('Open a ticket')}
        </button>
      </div>
    </form>
  );
}
