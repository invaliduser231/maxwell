'use client';

import type { FormsConfig } from '@maxwell/core/modules/forms';
import { useState, useTransition } from 'react';
import { Seg } from '@/components/controls';
import { useGuild, useRoleName } from '@/components/guild';
import { useDraft, useReadOnly } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { Avatar, Empty, Panel } from '@/components/ui';
import { usePoll } from '@/components/use-poll';
import type { Names } from '@/lib/people';
import { dayTime } from '@/lib/time';
import { decide, fetchSubmissions } from './actions';
import type { SubmissionView } from './load';

export type Show = 'waiting' | 'decided';

const shows = [
  { value: 'waiting', label: 'Waiting' },
  { value: 'decided', label: 'Decided' },
] as const;

const statusLabel = { pending: 'Waiting', accepted: 'Approved', declined: 'Declined' } as const;
const statusColor = { pending: '#F2C14E', accepted: '#2EB67D', declined: '#EC5B78' } as const;

export function tally(item: SubmissionView) {
  return {
    yes: item.votes.filter((vote) => vote.vote === 'accept').length,
    no: item.votes.filter((vote) => vote.vote === 'decline').length,
  };
}

export function ResponseList({
  items,
  names,
  now,
  show,
  onShow,
  selected,
  onSelect,
  more,
  loading,
  onMore,
}: {
  items: SubmissionView[];
  names: Names;
  now: number;
  show: Show;
  onShow: (next: Show) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  more: boolean;
  loading: boolean;
  onMore: () => void;
}) {
  const { timezone } = useGuild();
  return (
    <Panel
      title="Responses"
      id="f-responses"
      actions={<Seg label="Filter" value={show} options={shows} onChange={onShow} view />}
    >
      {items.length === 0 ? (
        <Empty>{show === 'waiting' ? 'Nothing waiting.' : 'Nothing decided yet.'}</Empty>
      ) : (
        items.map((item) => {
          const person = names[item.userId];
          const count = tally(item);
          return (
            <div key={item.id} className="mx-row">
              <Avatar src={person?.avatar} name={person?.name ?? '?'} size={28} />
              <button
                type="button"
                className="mx-pick mx-row-main"
                aria-pressed={item.id === selected}
                onClick={() => onSelect(item.id)}
              >
                <span className="mx-row-title mx-ellipsis">{person?.name ?? 'Former member'}</span>
                <span className="mx-sub">
                  <span className="mx-mono">#{item.number}</span>,{' '}
                  {dayTime(item.createdAt, now, timezone)}
                </span>
              </button>
              <span className="mx-sub">
                <span className="mx-up">{count.yes}</span> /{' '}
                <span className="mx-down">{count.no}</span>
                <span className="mx-sr"> votes for and against</span>
              </span>
              <span className="mx-chip" style={{ color: statusColor[item.status] }}>
                {statusLabel[item.status]}
              </span>
            </div>
          );
        })
      )}
      {more ? (
        <div className="mx-row" style={{ justifyContent: 'center' }}>
          <button type="button" className="mx-btn" disabled={loading} onClick={onMore}>
            {loading ? 'Loading' : 'Show more'}
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

export function ResponseDetail({
  item,
  names,
  now,
  onDecided,
}: {
  item: SubmissionView;
  names: Names;
  now: number;
  onDecided: () => void;
}) {
  const { guildId, timezone } = useGuild();
  const { value } = useDraft<FormsConfig>();
  const readOnly = useReadOnly();
  const roleName = useRoleName();
  const later = usePoll();
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();

  const form = value.forms.find((entry) => entry.id === item.formId);
  const person = names[item.userId];
  const needed = form?.votesToAccept ?? 0;
  const sub =
    item.present === false
      ? 'Left the server'
      : item.level !== null
        ? `Level ${item.level}`
        : dayTime(item.createdAt, now, timezone);

  const run = (decision: 'accept' | 'decline') =>
    start(async () => {
      const result = await decide(guildId, item.id, decision, note);
      if (!result.ok) {
        setStatus({ message: result.error, error: true });
        return;
      }
      setStatus({ message: decision === 'accept' ? 'Approving.' : 'Declining.', error: false });
      setNote('');
      later(
        async () => {
          const check = await fetchSubmissions(guildId, {
            formId: item.formId,
            decided: true,
          });
          const done = check.ok && check.data?.items.some((entry) => entry.id === item.id);
          if (done) {
            setStatus(null);
            onDecided();
          }
          return Boolean(done);
        },
        undefined,
        8,
      );
    });

  return (
    <Panel
      title={
        <>
          <span className="mx-mono mx-muted">#{item.number}</span> {person?.name ?? 'Former member'}
        </>
      }
      id="f-answer"
      actions={<span className="mx-sub">{sub}</span>}
    >
      <div className="mx-panel-body">
        {item.answers.length === 0 ? <span className="mx-sub">No answers</span> : null}
        {item.answers.map((answer) => (
          <div className="mx-field" key={answer.questionId}>
            <span className="mx-label">{answer.label}</span>
            <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {answer.display}
            </span>
          </div>
        ))}
      </div>
      <div className="mx-panel-head" style={{ borderTop: '1px solid var(--mx-line)' }}>
        <h3>Team vote</h3>
        {needed > 0 ? (
          <span className="mx-sub">
            {needed === 1 ? '1 approval needed' : `${needed} approvals needed`}
          </span>
        ) : null}
      </div>
      <div className="mx-panel-body">
        {item.votes.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {item.votes.map((vote) => (
              <span className="mx-chip" key={vote.userId}>
                {names[vote.userId]?.name ?? 'Former member'}{' '}
                {vote.vote === 'accept' ? 'approved' : 'declined'}
              </span>
            ))}
          </div>
        ) : (
          <span className="mx-sub">No votes yet</span>
        )}
        {item.status === 'pending' ? (
          readOnly ? null : (
            <>
              <input
                className="mx-input"
                aria-label="Note"
                placeholder="Note"
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="mx-btn"
                  disabled={pending}
                  onClick={() => run('decline')}
                >
                  Decline
                </button>
                <button
                  type="button"
                  className="mx-btn mx-btn-primary"
                  disabled={pending}
                  onClick={() => run('accept')}
                >
                  Approve
                </button>
                <StatusText status={status} />
              </div>
            </>
          )
        ) : (
          <>
            <span style={{ color: statusColor[item.status] }}>
              {statusLabel[item.status]}
              {item.decidedBy
                ? ` by ${names[item.decidedBy]?.name ?? 'Former member'}`
                : ' by votes'}
            </span>
            {item.decidedAt ? (
              <span className="mx-sub">{dayTime(item.decidedAt, now, timezone)}</span>
            ) : null}
            {item.note ? <span className="mx-sub">{item.note}</span> : null}
            {item.applied ? (
              <span className="mx-sub">
                {[
                  ...item.applied.addedRoleIds.map((id) => `Got ${roleName(id)}`),
                  ...item.applied.removedRoleIds.map((id) => `Lost ${roleName(id)}`),
                  item.applied.ticketId ? 'Ticket opened' : null,
                  item.applied.dmSent ? 'DM sent' : 'DM not delivered',
                ]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            ) : null}
          </>
        )}
      </div>
    </Panel>
  );
}

export function ResponsesEmpty({
  show,
  any,
  onShow,
  more,
  loading,
  onMore,
}: {
  show: Show;
  any: boolean;
  onShow: (next: Show) => void;
  more: boolean;
  loading: boolean;
  onMore: () => void;
}) {
  const text = !any
    ? 'No responses yet.'
    : show === 'waiting'
      ? 'Nothing waiting.'
      : 'Nothing decided yet.';
  return (
    <Panel
      title="Responses"
      id="f-responses"
      actions={
        any ? <Seg label="Filter" value={show} options={shows} onChange={onShow} view /> : null
      }
    >
      <Empty
        mood={any && show === 'waiting' ? 'happy' : 'sleeping'}
        action={
          more ? (
            <button type="button" className="mx-btn" disabled={loading} onClick={onMore}>
              {loading ? 'Loading' : 'Show more'}
            </button>
          ) : null
        }
      >
        {text}
      </Empty>
    </Panel>
  );
}
