'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState, useTransition } from 'react';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import { Empty, Grid, Panel } from '@/components/ui';
import type { Key } from '@/lib/i18n';
import type { Names } from '@/lib/people';
import { dayTime, span } from '@/lib/time';
import { reopenTicket } from '../actions';
import type { MessageView, TicketView } from '../load';
import { Message } from '../parts';

const sources: Record<string, Key> = {
  panel: 'Panel',
  modmail: 'Modmail',
  command: 'Command',
  form: 'Form',
  web: 'Web form',
};

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mx-row">
      <span className="mx-sub" style={{ width: 96, flexShrink: 0 }}>
        {label}
      </span>
      <div className="mx-row-main" style={{ overflowWrap: 'anywhere' }}>
        {children}
      </div>
    </div>
  );
}

export function TranscriptView({
  ticket,
  messages,
  names,
  now,
  panelName,
  canEdit,
}: {
  ticket: TicketView;
  messages: MessageView[];
  names: Names;
  now: number;
  panelName: string;
  canEdit: boolean;
}) {
  const t = useT();
  const { guildId, timezone } = useGuild();
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const name = (id: string | null) => (id ? (names[id]?.name ?? t('Former member')) : 'Maxwell');
  const end = ticket.closedAt ? Date.parse(ticket.closedAt) : now;
  const source = sources[ticket.source];

  const reopen = () =>
    start(async () => {
      const result = await reopenTicket(guildId, ticket.id);
      if (!result.ok) {
        setStatus({ message: result.error, error: true });
        return;
      }
      setStatus({ message: 'Reopening.', error: false });
      setTimeout(() => router.refresh(), 2500);
    });

  return (
    <Grid>
      <Panel
        title={ticket.subject ?? panelName}
        span={8}
        id="tr-messages"
        actions={
          <span className="mx-sub">{t.plural(messages.length, '{n} message', '{n} messages')}</span>
        }
      >
        {messages.length === 0 ? (
          <Empty>{t('No messages saved.')}</Empty>
        ) : (
          <div className="mx-panel-body">
            <div className="mx-preview">
              {messages.map((message) => (
                <Message key={message.id} message={message} names={names} now={now} full />
              ))}
            </div>
          </div>
        )}
      </Panel>
      <Panel
        title={t('Details')}
        span={4}
        id="tr-details"
        actions={
          <Link className="mx-btn mx-btn-ghost" href={`/g/${guildId}/tickets`}>
            {t('All tickets')}
          </Link>
        }
      >
        <Line label={t('Status')}>
          <span style={{ color: ticket.status === 'open' ? '#2EB67D' : '#C9CCD2' }}>
            {ticket.status === 'open' ? t('Still open') : t('Closed')}
          </span>
        </Line>
        <Line label={t('Opened by')}>{name(ticket.openerId)}</Line>
        <Line label={t('Panel')}>
          {panelName}
          {ticket.source !== 'panel' ? (
            <span className="mx-sub">{source ? t(source) : ticket.source}</span>
          ) : null}
        </Line>
        <Line label={t('Claimed by')}>
          {ticket.claimedBy ? name(ticket.claimedBy) : t('Nobody')}
        </Line>
        {ticket.members.length > 0 ? (
          <Line label={t('Added')}>{ticket.members.map((id) => name(id)).join(', ')}</Line>
        ) : null}
        <Line label={t('Opened')}>{dayTime(t, ticket.createdAt, now, timezone)}</Line>
        {ticket.firstResponseAt ? (
          <Line label={t('First reply')}>
            {t('{span} later', {
              span: span(t, Date.parse(ticket.firstResponseAt) - Date.parse(ticket.createdAt)),
            })}
          </Line>
        ) : null}
        {ticket.closedAt ? (
          <>
            <Line label={t('Closed')}>{dayTime(t, ticket.closedAt, now, timezone)}</Line>
            <Line label={t('Closed by')}>{name(ticket.closedBy)}</Line>
          </>
        ) : null}
        {ticket.closeReason ? <Line label={t('Reason')}>{ticket.closeReason}</Line> : null}
        <Line label={t('Open for')}>
          {span(t, Math.max(0, end - Date.parse(ticket.createdAt)))}
        </Line>
        <Line label={t('Rating')}>{ticket.rating ? `${ticket.rating} / 5` : t('None')}</Line>
        {canEdit && ticket.status === 'closed' ? (
          <div className="mx-panel-body" style={{ borderTop: '1px solid var(--mx-line)' }}>
            <div className="mx-inline">
              <TwoStep label={t('Reopen')} disabled={pending} run={reopen} />
              <StatusText status={status} />
            </div>
          </div>
        ) : null}
      </Panel>
    </Grid>
  );
}
