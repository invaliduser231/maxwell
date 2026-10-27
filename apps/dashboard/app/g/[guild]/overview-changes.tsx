'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { Avatar, Empty } from '@/components/ui';
import { ago, fullDate } from '@/lib/time';
import { sentence } from './audit/format';
import { UndoButton, UndoneChip } from './audit/undo';

export interface ChangeRow {
  id: string;
  actorId: string | null;
  actorName: string;
  actorAvatar: string | null;
  summary: string;
  createdAt: string;
  undone: boolean;
  undoable: boolean;
}

export function RecentChanges({
  rows,
  now,
  auditLink,
  span,
}: {
  rows: ChangeRow[];
  now: string;
  auditLink: boolean;
  span: 7 | 12;
}) {
  const { guildId, timezone } = useGuild();
  const t = useT();
  const [undone, setUndone] = useState<Record<string, boolean>>({});

  return (
    <section className={`mx-panel mx-s${span}`} aria-labelledby="overview-changes">
      <div className="mx-panel-head">
        <h2 id="overview-changes">{t('Recent changes')}</h2>
        {auditLink ? (
          <Link className="mx-btn mx-btn-ghost" href={`/g/${guildId}/audit`}>
            {t('Audit trail')}
          </Link>
        ) : null}
      </div>
      {rows.length === 0 ? <Empty>{t('No changes yet.')}</Empty> : null}
      {rows.map((row) => {
        const { text, byline } = sentence(t, row.actorId ? row.actorName : null, row.summary);
        const isUndone = row.undone || undone[row.id];
        return (
          <div key={row.id} className="mx-row">
            <Avatar src={row.actorAvatar} name={row.actorName} size={26} />
            <div className="mx-row-main">
              <span>{text}</span>
              <span className="mx-sub">
                <time dateTime={row.createdAt} title={fullDate(t, row.createdAt, timezone)}>
                  {ago(t, row.createdAt, now, timezone)}
                </time>
                {byline || !row.actorId ? `, ${row.actorName}` : null}
              </span>
            </div>
            {isUndone ? (
              <UndoneChip />
            ) : row.undoable ? (
              <UndoButton
                entryId={row.id}
                label={t('Undo: {summary}', { summary: row.summary })}
                ghost
                onUndone={() => setUndone((previous) => ({ ...previous, [row.id]: true }))}
              />
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
