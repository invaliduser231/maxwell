'use client';

import { useState, useTransition } from 'react';
import { useT } from './i18n';
import { useReadOnly } from './module-shell';
import { Row } from './ui';

export function TwoStep({
  label,
  danger,
  primary,
  ghost,
  disabled,
  confirm,
  ariaLabel,
  run,
}: {
  label: string;
  danger?: boolean;
  primary?: boolean;
  ghost?: boolean;
  disabled?: boolean;
  confirm?: string;
  ariaLabel?: string;
  run: () => void;
}) {
  const t = useT();
  const [armed, setArmed] = useState(false);
  const tone = danger
    ? ' mx-btn-danger'
    : primary
      ? ' mx-btn-primary'
      : ghost
        ? ' mx-btn-ghost'
        : '';
  return (
    <button
      type="button"
      className={`mx-btn${tone}`}
      disabled={disabled}
      aria-label={ariaLabel && armed ? t('Confirm: {name}', { name: ariaLabel }) : ariaLabel}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        run();
      }}
    >
      {armed ? (confirm ?? t('Click again to confirm')) : label}
    </button>
  );
}

export function DangerRow({
  label,
  sub,
  done,
  run,
}: {
  label: string;
  sub: string;
  done?: string;
  run: () => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const t = useT();
  const readOnly = useReadOnly();
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Row title={label} sub={note ?? sub}>
      <TwoStep
        label={label}
        danger
        disabled={pending || readOnly}
        run={() =>
          start(async () => {
            const result = await run();
            setNote(result.ok ? (done ?? null) : t.raw(result.error));
          })
        }
      />
    </Row>
  );
}
