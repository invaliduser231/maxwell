'use client';

import type { TicketsConfig } from '@maxwell/core/modules/tickets';
import type { TicketOverview } from '@maxwell/core/stores/tickets';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { AddPicker, Seg, Tabs, TextArea, TextInput } from '@/components/controls';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { fingerprint, useLive } from '@/components/live';
import { useDraft, useReadOnly } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import { Empty, Panel, PanelBody } from '@/components/ui';
import { usePoll } from '@/components/use-poll';
import type { Key } from '@/lib/i18n';
import type { Names } from '@/lib/people';
import { ago, inSentence, span } from '@/lib/time';
import {
  addTicketMember,
  claimTicket,
  closeTicket,
  fetchClosed,
  fetchTicket,
  sendReply,
} from './actions';
import { padNumber } from './format';
import type { Detail, TicketView } from './load';
import { PanelsTab, type Published } from './panels';
import { Message } from './parts';
import { SettingsTab } from './settings';

type Tab = 'open' | 'panels' | 'settings';
type Show = 'all' | 'mine' | 'unclaimed';

const tabs: { value: Tab; label: Key }[] = [
  { value: 'open', label: 'Open tickets' },
  { value: 'panels', label: 'Panels' },
  { value: 'settings', label: 'Settings' },
];

const shows: { value: Show; label: Key }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'unclaimed', label: 'Unclaimed' },
];

const URGENT = 4 * 3_600_000;

const column = { display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 } as const;

function rateColor(rating: number): string {
  if (rating >= 4) return '#2EB67D';
  if (rating === 3) return '#F2C14E';
  return '#EC5B78';
}

function usePanelName(): (id: string) => string {
  const { value } = useDraft<TicketsConfig>();
  return (id) =>
    id === 'modmail' ? 'Modmail' : (value.panels.find((panel) => panel.id === id)?.name ?? id);
}

function Stats({ overview }: { overview: TicketOverview }) {
  const t = useT();
  const median = overview.medianFirstResponseSeconds;
  const quiet = overview.open === 0 && overview.closedWeek === 0;
  const stats = [
    {
      label: t('Open tickets'),
      value: t.count(overview.open),
      note:
        overview.open === 0
          ? null
          : overview.unclaimed
            ? t('{count} unclaimed', { count: overview.unclaimed })
            : t('All claimed'),
    },
    {
      label: t('First reply, median'),
      value: median === null ? '0' : span(t, median * 1000),
      note: median === null ? null : t('Last 30 days'),
    },
    {
      label: t('Closed, 7 days'),
      value: t.count(overview.closedWeek),
      note: overview.closedWeekModmail
        ? t('{count} via modmail', { count: overview.closedWeekModmail })
        : null,
    },
    {
      label: t('Rating'),
      value:
        overview.averageRating === null
          ? '0'
          : overview.averageRating.toLocaleString(t.locale, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            }),
      note: overview.ratings ? t.plural(overview.ratings, '{n} rating', '{n} ratings') : null,
    },
  ];
  return (
    <div
      className={quiet ? 'mx-panel mx-stat-quiet' : 'mx-panel'}
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
    >
      {stats.map((stat) => (
        <div className="mx-stat" key={stat.label}>
          <span className="mx-stat-label">{stat.label}</span>
          <span className="mx-stat-value">{stat.value}</span>
          {stat.note ? <span className="mx-sub">{stat.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

function OpenList({
  open,
  names,
  now,
  selected,
  onSelect,
}: {
  open: TicketView[];
  names: Names;
  now: number;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const { userId } = useGuild();
  const panelName = usePanelName();
  const [show, setShow] = useState<Show>('all');
  const rows = open.filter((ticket) =>
    show === 'mine'
      ? ticket.claimedBy === userId
      : show === 'unclaimed'
        ? ticket.claimedBy === null
        : true,
  );
  return (
    <Panel
      title={t('Open tickets')}
      id="t-open"
      actions={
        open.length > 0 ? (
          <Seg
            label={t('Filter')}
            value={show}
            options={shows.map((option) => ({ ...option, label: t(option.label) }))}
            onChange={setShow}
            view
          />
        ) : null
      }
    >
      {rows.length === 0 ? (
        <Empty>{open.length === 0 ? t('No open tickets right now.') : t('Nothing here.')}</Empty>
      ) : (
        <div className="mx-scroll">
          <table className="mx-table">
            <thead>
              <tr>
                <th scope="col">{t('Ticket')}</th>
                <th scope="col">{t('Opened by')}</th>
                <th scope="col">{t('Panel')}</th>
                <th scope="col">{t('Claimed by')}</th>
                <th scope="col">{t('Waiting')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ticket) => {
                const waiting = now - Date.parse(ticket.lastMessageAt);
                const urgent = waiting > URGENT && !ticket.claimedBy;
                return (
                  <tr key={ticket.id}>
                    <td>
                      <button
                        type="button"
                        className="mx-pick"
                        aria-pressed={ticket.id === selected}
                        onClick={() => onSelect(ticket.id)}
                      >
                        <span className="mx-mono">#{padNumber(ticket.number)}</span>{' '}
                        {ticket.subject ?? panelName(ticket.panelId)}
                      </button>
                    </td>
                    <td>
                      {names[ticket.openerId]?.name ?? t('Former member')}
                      {ticket.source === 'modmail' ? (
                        <span className="mx-chip" style={{ marginLeft: 4 }}>
                          Modmail
                        </span>
                      ) : null}
                    </td>
                    <td>{panelName(ticket.panelId)}</td>
                    <td style={{ color: ticket.claimedBy ? 'inherit' : '#F2C14E' }}>
                      {ticket.claimedBy
                        ? (names[ticket.claimedBy]?.name ?? t('Former member'))
                        : t('Unclaimed')}
                    </td>
                    <td
                      style={{
                        color: urgent ? '#F2C14E' : 'var(--mx-text-2)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {span(t, waiting)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function TicketDetail({
  detail,
  now,
  onChanged,
}: {
  detail: Detail | null;
  now: number;
  onChanged: (next: Detail) => void;
}) {
  const t = useT();
  const { guildId, userId } = useGuild();
  const { value } = useDraft<TicketsConfig>();
  const readOnly = useReadOnly();
  const router = useRouter();
  const later = usePoll();
  const panelName = usePanelName();
  const [draft, setDraft] = useState('');
  const [member, setMember] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);
  const ticketId = detail?.ticket.id ?? null;
  const count = detail?.messages.length ?? 0;

  useEffect(() => {
    if (!ticketId) return;
    setDraft('');
    setMember(null);
    setStatus(null);
  }, [ticketId]);

  useEffect(() => {
    if (count && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [count]);

  if (!detail) {
    return (
      <Panel title={t('Ticket')} id="t-detail">
        <PanelBody>
          <span className="mx-sub">{t('Loading')}</span>
        </PanelBody>
      </Panel>
    );
  }

  const { ticket } = detail;
  const mine = ticket.claimedBy === userId;

  const act = (
    run: () => Promise<{ ok: boolean; error?: string }>,
    done: string,
    changed: (next: Detail) => boolean,
  ) =>
    start(async () => {
      const result = await run();
      if (!result.ok) {
        setStatus({ message: result.error ?? 'That did not work.', error: true });
        return;
      }
      setStatus({ message: done, error: false });
      later(
        async () => {
          const next = await fetchTicket(guildId, ticket.id);
          if (!next.ok || !next.data) return false;
          if (!changed(next.data)) return false;
          onChanged(next.data);
          setStatus(null);
          router.refresh();
          return true;
        },
        undefined,
        8,
      );
    });

  return (
    <Panel
      title={
        <>
          <span className="mx-mono">#{padNumber(ticket.number)}</span>{' '}
          {ticket.subject ?? panelName(ticket.panelId)}
        </>
      }
      id="t-detail"
      actions={
        <>
          <span className="mx-sub">{panelName(ticket.panelId)}</span>
          <Link className="mx-btn mx-btn-ghost" href={`/g/${guildId}/tickets/${ticket.id}`}>
            {t('Transcript')}
          </Link>
        </>
      }
    >
      <div className="mx-panel-body">
        <div
          className="mx-preview"
          ref={scroller}
          style={{ maxHeight: 380, overflowY: 'auto' }}
          role="log"
          aria-label={t('Latest messages')}
        >
          {detail.messages.length === 0 ? (
            <span className="mx-sub">{t('No messages saved.')}</span>
          ) : (
            detail.messages.map((message) => (
              <Message key={message.id} message={message} names={detail.names} now={now} />
            ))
          )}
        </div>
        {readOnly || ticket.status !== 'open' ? null : (
          <>
            <TextArea
              rows={2}
              label={t('Reply')}
              placeholder={t('Reply as staff')}
              maxLength={2000}
              value={draft}
              onChange={setDraft}
            />
            {member !== null ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TextInput
                    mono
                    label={t('Member ID')}
                    placeholder={t('User ID')}
                    value={member}
                    onChange={setMember}
                  />
                </div>
                <button
                  type="button"
                  className="mx-btn"
                  disabled={pending || !member.trim()}
                  onClick={() => {
                    const size = ticket.members.length;
                    act(
                      () => addTicketMember(guildId, ticket.id, member),
                      'Adding.',
                      (next) => next.ticket.members.length > size,
                    );
                    setMember(null);
                  }}
                >
                  {t('Add')}
                </button>
                <button
                  type="button"
                  className="mx-btn mx-btn-ghost"
                  onClick={() => setMember(null)}
                >
                  {t('Cancel')}
                </button>
              </div>
            ) : null}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className="mx-btn"
                  disabled={pending}
                  onClick={() =>
                    act(
                      () => claimTicket(guildId, ticket.id, mine),
                      mine ? 'Letting go.' : 'Claiming.',
                      (next) => next.ticket.claimedBy !== ticket.claimedBy,
                    )
                  }
                >
                  {mine ? t('Unclaim') : t('Claim')}
                </button>
                {member !== null ? null : (
                  <button type="button" className="mx-btn" onClick={() => setMember('')}>
                    {t('Add member')}
                  </button>
                )}
                {value.cannedReplies.length > 0 ? (
                  <AddPicker
                    label={t('Saved reply')}
                    options={value.cannedReplies.map((reply) => ({
                      value: reply.name,
                      label: reply.name,
                    }))}
                    onPick={(name) =>
                      setDraft(
                        value.cannedReplies.find((reply) => reply.name === name)?.content ?? '',
                      )
                    }
                  />
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <StatusText status={status} />
                <TwoStep
                  label={t('Close')}
                  danger
                  disabled={pending}
                  run={() =>
                    act(
                      () => closeTicket(guildId, ticket.id, ''),
                      'Closing.',
                      (next) => next.ticket.status === 'closed',
                    )
                  }
                />
                <button
                  type="button"
                  className="mx-btn mx-btn-primary"
                  disabled={pending || !draft.trim()}
                  onClick={() => {
                    const total = detail.total;
                    act(
                      () => sendReply(guildId, ticket.id, draft),
                      'Sending.',
                      (next) => next.total > total,
                    );
                    setDraft('');
                  }}
                >
                  {t('Send')}
                </button>
              </div>
            </div>
          </>
        )}
        {readOnly && status ? <StatusText status={status} /> : null}
      </div>
    </Panel>
  );
}

function Closed({
  initial,
  initialMore,
  names: initialNames,
  now,
}: {
  initial: TicketView[];
  initialMore: boolean;
  names: Names;
  now: number;
}) {
  const t = useT();
  const { guildId } = useGuild();
  const { value } = useDraft<TicketsConfig>();
  const panelName = usePanelName();
  const [items, setItems] = useState(initial);
  const [extra, setExtra] = useState<Names>({});
  const [more, setMore] = useState(initialMore);
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const names = { ...initialNames, ...extra };

  const seen = useRef({ key: fingerprint(initial), length: initial.length });

  useEffect(() => {
    const key = fingerprint(initial);
    if (key === seen.current.key) return;
    const firstLength = seen.current.length;
    seen.current = { key, length: initial.length };
    const known = new Set(initial.map((item) => item.id));
    setItems((previous) => [
      ...initial,
      ...previous.slice(firstLength).filter((item) => !known.has(item.id)),
    ]);
    setMore((previous) => previous || initialMore);
  }, [initial, initialMore]);

  const loadMore = () =>
    start(async () => {
      const result = await fetchClosed(guildId, items.length);
      if (!result.ok || !result.data) {
        setStatus({ message: result.ok ? 'Nothing more.' : result.error, error: true });
        return;
      }
      const page = result.data;
      setItems((previous) => [
        ...previous,
        ...page.items.filter((item) => !previous.some((known) => known.id === item.id)),
      ]);
      setExtra((previous) => ({ ...previous, ...page.names }));
      setMore(page.more);
    });

  return (
    <Panel
      title={t('Recently closed')}
      id="t-closed"
      actions={
        value.transcripts ? null : <span className="mx-sub">{t('Transcripts are off')}</span>
      }
    >
      {items.length === 0 ? (
        <Empty>{t('Nothing closed yet.')}</Empty>
      ) : (
        <>
          {items.map((ticket) => {
            const closer = ticket.closedBy
              ? (names[ticket.closedBy]?.name ?? t('Former member'))
              : 'Maxwell';
            const when = ticket.closedAt
              ? t('closed {when}', { when: inSentence(t, ago(t, ticket.closedAt, now)) })
              : t('closed');
            return (
              <div className="mx-row" key={ticket.id}>
                <span className="mx-mono mx-muted" style={{ width: 52, flexShrink: 0 }}>
                  #{padNumber(ticket.number)}
                </span>
                <div className="mx-row-main">
                  <span className="mx-row-title mx-ellipsis">
                    {ticket.subject ?? panelName(ticket.panelId)}
                  </span>
                  <span className="mx-sub mx-ellipsis">
                    {closer}, {when}
                    {ticket.closeReason ? `, ${ticket.closeReason}` : ''}
                  </span>
                </div>
                {ticket.rating ? (
                  <span className="mx-chip" style={{ color: rateColor(ticket.rating) }}>
                    {ticket.rating} / 5
                  </span>
                ) : null}
                <Link className="mx-btn mx-btn-ghost" href={`/g/${guildId}/tickets/${ticket.id}`}>
                  {t('Transcript')}
                </Link>
              </div>
            );
          })}
          {more ? (
            <div className="mx-row" style={{ justifyContent: 'center' }}>
              <button type="button" className="mx-btn" disabled={pending} onClick={loadMore}>
                {pending ? t('Loading') : t('Show more')}
              </button>
              <StatusText status={status} />
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}

function Ratings({ overview }: { overview: TicketOverview }) {
  const t = useT();
  const counts = overview.ratingCounts;
  const top = Math.max(1, ...counts);
  return (
    <Panel
      title={t('Ratings, 30 days')}
      id="t-ratings"
      actions={
        overview.averageRating === null ? null : (
          <span className="mx-sub">
            {t('{value} average', {
              value: overview.averageRating.toLocaleString(t.locale, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }),
            })}
          </span>
        )
      }
    >
      {overview.ratings === 0 ? (
        <Empty>{t('No ratings yet.')}</Empty>
      ) : (
        <div className="mx-panel-body">
          {[5, 4, 3, 2, 1].map((stars) => {
            const count = counts[stars - 1] ?? 0;
            const label = t.plural(stars, '{n} star', '{n} stars');
            return (
              <div key={stars} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="mx-sub" style={{ width: 60 }}>
                  {label}
                </span>
                <div
                  className="mx-bar"
                  style={{ flex: 1 }}
                  role="img"
                  aria-label={`${label}: ${count}`}
                >
                  <span style={{ width: `${Math.round((count / top) * 100)}%` }} />
                </div>
                <span style={{ width: 28, textAlign: 'right' }}>{count}</span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

export function TicketsView({
  now,
  overview,
  open,
  closed,
  moreClosed,
  names,
  first,
  saved,
  published,
}: {
  now: number;
  overview: TicketOverview;
  open: TicketView[];
  closed: TicketView[];
  moreClosed: boolean;
  names: Names;
  first: Detail | null;
  saved: TicketsConfig;
  published: Published[];
}) {
  const t = useT();
  const { guildId } = useGuild();
  const { value } = useDraft<TicketsConfig>();
  const readOnly = useReadOnly();
  const [tab, setTab] = useState<Tab>('open');
  const [selected, setSelected] = useState<string | null>(first?.ticket.id ?? null);
  const [detail, setDetail] = useState<Detail | null>(first);
  const [known, setKnown] = useState<Names>(names);
  const [, start] = useTransition();

  useEffect(() => {
    setKnown((previous) => ({ ...previous, ...names }));
  }, [names]);

  useEffect(() => {
    if (!selected && open[0]) {
      setSelected(open[0].id);
      return;
    }
    if (selected && !open.some((ticket) => ticket.id === selected)) {
      const next = open[0]?.id ?? null;
      setSelected(next);
      if (!next) setDetail(null);
    }
  }, [open, selected]);

  useLive(['tickets'], () => {
    if (!selected) return;
    fetchTicket(guildId, selected)
      .then((result) => {
        if (!result.ok || !result.data) return;
        const data = result.data;
        setDetail((previous) => (previous?.ticket.id === data.ticket.id ? data : previous));
        setKnown((previous) => ({ ...previous, ...data.names }));
      })
      .catch(() => {});
  });

  useEffect(() => {
    if (!selected || detail?.ticket.id === selected) return;
    start(async () => {
      const result = await fetchTicket(guildId, selected);
      if (result.ok && result.data) {
        const data = result.data;
        setDetail(data);
        setKnown((previous) => ({ ...previous, ...data.names }));
      }
    });
  }, [selected, detail, guildId]);

  const hasStats =
    overview.open > 0 ||
    overview.closedWeek > 0 ||
    overview.ratings > 0 ||
    overview.medianFirstResponseSeconds !== null;
  const nothing = open.length === 0 && closed.length === 0;
  const side = selected !== null || overview.ratings > 0;

  return (
    <>
      {hasStats ? <Stats overview={overview} /> : null}
      <Tabs
        label={t('Tickets')}
        value={tab}
        options={tabs.map((option) => ({ ...option, label: t(option.label) }))}
        onChange={setTab}
      />
      {tab === 'open' && nothing ? (
        <Panel id="t-open">
          <Empty mood="sleeping">
            <div className="mx-stack" style={{ alignItems: 'center' }}>
              <span>
                {value.panels.length === 0
                  ? t('No tickets yet. Members open them from a panel.')
                  : t('No tickets yet.')}
              </span>
              {value.panels.length === 0 && !readOnly ? (
                <button
                  type="button"
                  className="mx-btn mx-btn-primary"
                  onClick={() => setTab('panels')}
                >
                  {t('Set up a panel')}
                </button>
              ) : null}
            </div>
          </Empty>
        </Panel>
      ) : null}
      {tab === 'open' && !nothing ? (
        <div className="mx-grid">
          <div className={side ? 'mx-s7' : 'mx-s12'} style={column}>
            <OpenList
              open={open}
              names={known}
              now={now}
              selected={selected}
              onSelect={setSelected}
            />
            {closed.length > 0 ? (
              <Closed initial={closed} initialMore={moreClosed} names={known} now={now} />
            ) : null}
          </div>
          {side ? (
            <div className="mx-s5" style={column}>
              {selected !== null ? (
                <TicketDetail
                  detail={detail && detail.ticket.id === selected ? detail : null}
                  now={now}
                  onChanged={(next) => {
                    setDetail(next);
                    setKnown((previous) => ({ ...previous, ...next.names }));
                  }}
                />
              ) : null}
              {overview.ratings > 0 ? <Ratings overview={overview} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {tab === 'panels' ? <PanelsTab saved={saved} published={published} /> : null}
      {tab === 'settings' ? <SettingsTab /> : null}
    </>
  );
}
