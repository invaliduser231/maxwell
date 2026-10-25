'use client';

import type { CaseAction } from '@maxwell/core/modules/moderation';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Seg, Select, Tabs } from '@/components/controls';
import { useGuild } from '@/components/guild';
import { Empty, Grid } from '@/components/ui';
import { plural, until, when } from '@/lib/time';
import { CaseDetail } from './case-detail';
import type { CaseView } from './data';
import { ACTION_COLORS, ACTION_NAMES } from './labels';
import type { CaseQuery, Range, Stats } from './query';
import { type CommandRow, SettingsTab } from './settings';

type Tab = 'cases' | 'settings';

const actionFilters: { value: CaseAction | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ban', label: 'Ban' },
  { value: 'timeout', label: 'Timeout' },
  { value: 'warn', label: 'Warn' },
  { value: 'kick', label: 'Kick' },
  { value: 'flag', label: 'Review' },
];

const rangeOptions: { value: Range; label: string }[] = [
  { value: 'all', label: 'Any time' },
  { value: 'day', label: 'Last 24 hours' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
];

function StatsBar({ stats, now }: { stats: Stats; now: string }) {
  const { timezone } = useGuild();
  const share = stats.total30 > 0 ? Math.round((stats.automated30 / stats.total30) * 100) : 0;
  const quiet = stats.activeTimeouts + stats.activeBans + stats.warns30 + stats.total30 === 0;
  const items = [
    {
      label: 'Active timeouts',
      value: stats.activeTimeouts.toLocaleString('en-US'),
      sub: stats.timeoutEndsAt ? `Longest ends ${until(stats.timeoutEndsAt, now, timezone)}` : null,
    },
    {
      label: 'Active bans',
      value: stats.activeBans.toLocaleString('en-US'),
      sub:
        stats.temporaryBans > 0 ? `${stats.temporaryBans.toLocaleString('en-US')} temporary` : null,
    },
    {
      label: 'Warns, 30 days',
      value: stats.warns30.toLocaleString('en-US'),
      sub: stats.warned30 > 0 ? plural(stats.warned30, 'member') : null,
    },
    {
      label: 'Handled by Maxwell',
      value: `${share}%`,
      sub: stats.total30 > 0 ? `of ${plural(stats.total30, 'case')}, 30 days` : null,
    },
  ];
  return (
    <div
      className={quiet ? 'mx-panel mx-stat-quiet' : 'mx-panel'}
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
    >
      {items.map((item) => (
        <div key={item.label} className="mx-stat">
          <span className="mx-stat-label">{item.label}</span>
          <span className="mx-stat-value">{item.value}</span>
          {item.sub ? <span className="mx-sub">{item.sub}</span> : null}
        </div>
      ))}
    </div>
  );
}

function CasesTab({
  query,
  cases,
  more,
  selected,
  stats,
  moderators,
  now,
  onSettings,
}: {
  query: CaseQuery;
  cases: CaseView[];
  more: boolean;
  selected: CaseView | null;
  stats: Stats;
  moderators: { id: string; name: string }[];
  now: string;
  onSettings: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { timezone } = useGuild();
  const [search, setSearch] = useState(query.q);
  const [pending, start] = useTransition();

  const go = (patch: Partial<CaseQuery> & { case?: number | null }) => {
    const next = { ...query, page: 0, ...patch };
    const params = new URLSearchParams();
    if (next.action) params.set('action', next.action);
    if (next.mod) params.set('mod', next.mod);
    if (next.range !== 'all') params.set('range', next.range);
    if (next.q) params.set('q', next.q);
    if (next.page > 0) params.set('page', String(next.page));
    const caseNumber = patch.case === undefined ? null : patch.case;
    if (caseNumber) params.set('case', String(caseNumber));
    const text = params.toString();
    start(() => router.push(text ? `${pathname}?${text}` : pathname, { scroll: false }));
  };

  const filtered = Boolean(query.action || query.mod || query.q || query.range !== 'all');
  const knownMod = !query.mod || moderators.some((entry) => entry.id === query.mod);
  const modOptions = [
    { value: '', label: 'Any moderator' },
    ...(knownMod || !query.mod ? [] : [{ value: query.mod, label: query.mod }]),
    ...moderators.map((entry) => ({ value: entry.id, label: entry.name })),
  ];
  const nothing = cases.length === 0 && !filtered && query.page === 0;

  if (nothing) {
    return (
      <section className="mx-panel" aria-label="Cases">
        <Empty mood="sleeping">
          <div className="mx-stack" style={{ alignItems: 'center' }}>
            <span>No cases yet.</span>
            <button type="button" className="mx-btn" onClick={onSettings}>
              Open settings
            </button>
          </div>
        </Empty>
      </section>
    );
  }

  return (
    <>
      <StatsBar stats={stats} now={now} />
      <Grid>
        <section className={`mx-panel mx-s${selected ? 8 : 12}`} aria-labelledby="cases-title">
          <div className="mx-panel-head">
            <h2 id="cases-title">Cases</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Seg
                label="Filter by action"
                value={query.action ?? 'all'}
                options={actionFilters}
                onChange={(next) => go({ action: next === 'all' ? null : next })}
                view
              />
            </div>
          </div>
          <div className="mx-inline" style={{ padding: '6px 16px 12px' }}>
            <Select
              label="Filter by moderator"
              value={query.mod ?? ''}
              options={modOptions}
              style={{ width: 170 }}
              onChange={(next) => go({ mod: next || null })}
            />
            <Select
              label="Filter by time"
              value={query.range}
              options={rangeOptions}
              style={{ width: 150 }}
              onChange={(next) => go({ range: next })}
            />
            <form
              role="search"
              style={{ flex: '1 1 180px' }}
              onSubmit={(event) => {
                event.preventDefault();
                go({ q: search.trim() });
              }}
            >
              <input
                className="mx-input"
                type="search"
                aria-label="Search cases"
                placeholder="Member ID, reason or case"
                value={search}
                maxLength={100}
                onChange={(event) => {
                  setSearch(event.target.value);
                  if (!event.target.value && query.q) go({ q: '' });
                }}
              />
            </form>
          </div>
          {cases.length === 0 ? (
            <Empty mood="thinking">
              <div className="mx-stack" style={{ alignItems: 'center' }}>
                <span>{filtered ? 'No cases match.' : 'Nothing on this page.'}</span>
                {filtered ? (
                  <button
                    type="button"
                    className="mx-btn"
                    onClick={() => {
                      setSearch('');
                      go({ action: null, mod: null, range: 'all', q: '' });
                    }}
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            </Empty>
          ) : (
            <div className="mx-scroll" style={{ opacity: pending ? 0.6 : 1 }}>
              <table className="mx-table">
                <thead>
                  <tr>
                    <th scope="col">Case</th>
                    <th scope="col">Action</th>
                    <th scope="col">Member</th>
                    <th scope="col">Moderator</th>
                    <th scope="col">Reason</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((entry) => (
                    <tr
                      key={entry.number}
                      style={{
                        background:
                          entry.number === selected?.number ? 'var(--mx-inset)' : undefined,
                      }}
                    >
                      <td>
                        <button
                          type="button"
                          className="mx-btn mx-btn-ghost mx-mono"
                          aria-label={`Open case ${entry.number}`}
                          style={{ padding: '2px 6px', minHeight: 26 }}
                          onClick={() => go({ page: query.page, case: entry.number })}
                        >
                          #{entry.number}
                        </button>
                      </td>
                      <td>
                        <span
                          className="mx-chip"
                          style={{
                            color: entry.voidedAt
                              ? 'var(--mx-muted)'
                              : (ACTION_COLORS[entry.action] ?? 'var(--mx-text-2)'),
                          }}
                        >
                          {ACTION_NAMES[entry.action] ?? entry.action}
                        </span>
                      </td>
                      <td>{entry.member}</td>
                      <td className="mx-muted">{entry.moderator}</td>
                      <td
                        className={entry.voidedAt || !entry.reason ? 'mx-muted' : undefined}
                        style={{
                          maxWidth: 260,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {entry.voidedAt ? 'Void' : (entry.reason ?? 'No reason')}
                      </td>
                      <td className="mx-muted" style={{ whiteSpace: 'nowrap' }}>
                        {when(entry.createdAt, now, timezone)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {query.page > 0 || more ? (
            <div className="mx-row" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                className="mx-btn"
                disabled={query.page === 0 || pending}
                onClick={() => go({ page: query.page - 1 })}
              >
                Newer
              </button>
              <span className="mx-sub">Page {query.page + 1}</span>
              <button
                type="button"
                className="mx-btn"
                disabled={!more || pending}
                onClick={() => go({ page: query.page + 1 })}
              >
                Older
              </button>
            </div>
          ) : null}
        </section>

        {selected ? <CaseDetail key={selected.number} initial={selected} now={now} /> : null}
      </Grid>
    </>
  );
}

export function ModerationView({
  initialTab,
  query,
  cases,
  more,
  selected,
  stats,
  moderators,
  commands,
  prefix,
  guildName,
  viewerName,
  now,
}: {
  initialTab: Tab;
  query: CaseQuery;
  cases: CaseView[];
  more: boolean;
  selected: CaseView | null;
  stats: Stats;
  moderators: { id: string; name: string }[];
  commands: CommandRow[];
  prefix: string;
  guildName: string;
  viewerName: string;
  now: string;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const pick = (next: Tab) => {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      if (next === 'settings') url.searchParams.set('tab', 'settings');
      else url.searchParams.delete('tab');
      window.history.replaceState(null, '', url);
    } catch {}
  };
  return (
    <>
      <Tabs
        label="Moderation"
        value={tab}
        options={[
          { value: 'cases', label: 'Cases' },
          { value: 'settings', label: 'Settings' },
        ]}
        onChange={pick}
      />
      {tab === 'cases' ? (
        <CasesTab
          query={query}
          cases={cases}
          more={more}
          selected={selected}
          stats={stats}
          moderators={moderators}
          now={now}
          onSettings={() => pick('settings')}
        />
      ) : (
        <SettingsTab
          commands={commands}
          prefix={prefix}
          guildName={guildName}
          viewerName={viewerName}
        />
      )}
    </>
  );
}
