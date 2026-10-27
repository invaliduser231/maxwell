'use client';

import { useState } from 'react';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { failed, StatusText } from '@/components/status-text';
import { usePoll } from '@/components/use-poll';
import { undoEntry } from '@/lib/actions';
import { undoneStates } from './actions';

export function UndoneChip() {
  const t = useT();
  return (
    <span className="mx-chip" style={{ color: 'var(--mx-success)' }}>
      {t('Undone')}
    </span>
  );
}

export function UndoButton({
  entryId,
  label,
  ghost,
  onUndone,
}: {
  entryId: string;
  label: string;
  ghost?: boolean;
  onUndone: () => void;
}) {
  const { guildId } = useGuild();
  const t = useT();
  const poll = usePoll();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setWorking(true);
    setError(null);
    const result = await undoEntry(guildId, entryId).catch(() => null);
    if (!result?.ok) {
      setWorking(false);
      setError(result && !result.ok ? result.error : t('That did not work.'));
      return;
    }
    poll(
      async () => {
        const states = await undoneStates(guildId, [entryId]);
        if (states.ok && states.data?.[entryId]) {
          setWorking(false);
          onUndone();
          return true;
        }
        return false;
      },
      () => {
        setWorking(false);
        setError(t('Maxwell has not finished yet.'));
      },
      30,
    );
  };

  return (
    <>
      <StatusText status={error ? failed(error) : null} />
      <button
        type="button"
        className={ghost ? 'mx-btn mx-btn-ghost' : 'mx-btn'}
        disabled={working}
        aria-label={label}
        onClick={run}
      >
        {working ? t('Undoing') : t('Undo')}
      </button>
    </>
  );
}
