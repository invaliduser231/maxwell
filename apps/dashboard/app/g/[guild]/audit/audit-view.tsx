'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Seg, Select } from '@/components/controls';
import { useGuild } from '@/components/guild';
import { useLive } from '@/components/live';
import { Avatar, Chip, Empty, Field, Fields, PanelBody } from '@/components/ui';
import { ago, fullDate } from '@/lib/time';
import { loadAudit } from './actions';
import type { AuditRow } from './data';
import type { DiffLine } from './diff';
import { type AuditQuery, kindInfo, kindOf, ranges, sentence } from './format';
import { UndoButton, UndoneChip } from './undo';

const SNOWFLAKE = /\b\d{15,21}\b/g;

const kinds: { value: AuditQuery['kind']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'settings', label: 'Settings' },
  { value: 'mod', label: 'Mod actions' },
  { value: 'auto', label: 'Automatic' },
];

function useNames(): (text: string) => string {
  const { channels, roles } = useGuild();
  return (text) =>
    text.replace(SNOWFLAKE, (id) => {
      const channel = channels.find((entry) => entry.id === id);
      if (channel) return `#${channel.name}`;
      const role = roles.find((entry) => entry.id === id);
      if (role) return `@${role.name}`;
      return id;
    });
}

function Diff({ lines, id }: { lines: DiffLine[]; id: string }) {
  const names = useNames();
  if (lines.length === 0) {
    return (
      <div id={id} className="mx-sub" style={{ margin: '0 16px 12px 54px' }}>
        No details recorded.
      </div>
    );
  }
  const seen = new Map<string, number>();
  const keyed = lines.map((line) => {
    const base = `${line.sign}${line.text}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { line, key: `${base}:${n}` };
  });
  return (
    <div
      id={id}
      className="mx-inset"
      style={{
        margin: '0 16px 12px 54px',
        overflow: 'hidden',
        fontFamily: 'var(--mx-mono)',
        fontSize: 13,
      }}
    >
      {keyed.map(({ line, key }) => (
        <div
          key={key}
          style={{
            display: 'flex',
            gap: 10,
            padding: '4px 10px',
            background:
              line.sign === '+'
                ? 'rgba(46, 182, 125, .12)'
                : line.sign === '-'
                  ? 'rgba(236, 91, 120, .12)'
                  : 'transparent',
            color:
              line.sign === '+' ? '#9EE0C2' : line.sign === '-' ? '#F4A9B9' : 'var(--mx-muted)',
          }}
        >
          <span style={{ width: 10, flexShrink: 0 }} aria-hidden="true">
            {line.sign}
          </span>
          <span className="mx-sr">
            {line.sign === '+' ? 'Added' : line.sign === '-' ? 'Removed' : ''}
          </span>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{names(line.text)}</span>
        </div>
      ))}
    </div>
  );
}

function Entry({
  row,
  first,
  now,
  onUndone,
}: {
  row: AuditRow;
  first: boolean;
  now: string;
  onUndone: () => void;
}) {
  const { timezone } = useGuild();
  const [open, setOpen] = useState(false);
  const kind = kindInfo[kindOf(row.actorId, row.action)];
  const { text, byline } = sentence(row.actorId ? row.actorName : null, row.summary);
  const diffId = `audit-diff-${row.id}`;
  return (
    <div style={{ borderTop: first ? 0 : '1px solid var(--mx-line)' }}>
      <div className="mx-row" style={{ borderTop: 0, flexWrap: 'wrap' }}>
        <Avatar src={row.actorAvatar} name={row.actorName} size={26} />
        <div className="mx-row-main" style={{ minWidth: 200 }}>
          <span>{text}</span>
          <span className="mx-sub">
            <time dateTime={row.createdAt} title={fullDate(row.createdAt, timezone)}>
              {ago(row.createdAt, now, timezone)}
            </time>
            {byline || !row.actorId ? `, ${row.actorName}` : null}
          </span>
        </div>
        <div className="mx-inline">
          <Chip>{row.moduleName}</Chip>
          <Chip>{kind.name}</Chip>
        </div>
        <button
          type="button"
          className="mx-btn mx-btn-ghost"
          aria-expanded={open}
          aria-controls={open ? diffId : undefined}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Hide' : 'Details'}
        </button>
        {row.undoneAt ? (
          <UndoneChip />
        ) : row.undoable ? (
          <UndoButton entryId={row.id} label={`Undo: ${row.summary}`} onUndone={onUndone} />
        ) : row.hasUndo ? (
          <span className="mx-sub" style={{ whiteSpace: 'nowrap' }}>
            Too old to undo
          </span>
        ) : null}
      </div>
      {open ? <Diff lines={row.diff} id={diffId} /> : null}
    </div>
  );
}

export function AuditView({
  initial,
  more: initialMore,
  now: initialNow,
  query: initialQuery,
  actors,
  modules,
}: {
  initial: AuditRow[];
  more: boolean;
  now: string;
  query: AuditQuery;
  actors: { value: string; label: string }[];
  modules: { value: string; label: string }[];
}) {
  const { guildId } = useGuild();
  const [query, setQuery] = useState(initialQuery);
  const [search, setSearch] = useState(initialQuery.search);
  const [rows, setRows] = useState(initial);
  const [more, setMore] = useState(initialMore);
  const [now, setNow] = useState(initialNow);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const request = useRef(0);
  const firstRun = useRef(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery((previous) => (previous.search === search ? previous : { ...previous, search }));
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const ticket = ++request.current;
    start(async () => {
      const result = await loadAudit(guildId, query);
      if (ticket !== request.current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setRows(result.data?.rows ?? []);
      setMore(result.data?.more ?? false);
      setNow(new Date().toISOString());
    });
  }, [guildId, query]);

  useLive(['audit'], () => {
    const ticket = request.current;
    loadAudit(guildId, query)
      .then((result) => {
        if (ticket !== request.current || !result.ok || !result.data) return;
        const fresh = result.data.rows;
        const known = new Set(fresh.map((row) => row.id));
        const oldest = fresh.at(-1)?.id;
        setRows((previous) => [
          ...fresh,
          ...previous.filter(
            (row) => !known.has(row.id) && oldest !== undefined && BigInt(row.id) < BigInt(oldest),
          ),
        ]);
        setNow(new Date().toISOString());
      })
      .catch(() => {});
  });

  const loadMore = () => {
    const last = rows.at(-1);
    if (!last) return;
    const ticket = request.current;
    start(async () => {
      const result = await loadAudit(guildId, query, last.id);
      if (ticket !== request.current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setRows((previous) => [...previous, ...(result.data?.rows ?? [])]);
      setMore(result.data?.more ?? false);
    });
  };

  const markUndone = (id: string) =>
    setRows((previous) =>
      previous.map((row) =>
        row.id === id ? { ...row, undoneAt: new Date().toISOString(), undoable: false } : row,
      ),
    );

  const filtered =
    query.actor !== null ||
    query.module !== null ||
    query.range !== 'any' ||
    query.kind !== 'all' ||
    search.trim() !== '';

  const clear = () => {
    setSearch('');
    setQuery({ ...query, actor: null, module: null, range: 'any', kind: 'all', search: '' });
  };

  if (rows.length === 0 && !filtered && !pending && !error) {
    return (
      <section className="mx-panel" aria-label="Changes and actions">
        <Empty mood="sleeping">Nothing has happened here yet.</Empty>
      </section>
    );
  }

  return (
    <>
      <section className="mx-panel" aria-label="Filters">
        <PanelBody>
          <Fields>
            <Field label="Search">
              <input
                className="mx-input"
                type="text"
                role="searchbox"
                enterKeyHint="search"
                value={search}
                maxLength={100}
                placeholder="@n0tabot, #memes, case #41"
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
            <Field label="Who">
              <Select
                value={query.actor ?? ''}
                searchable={actors.length > 8}
                options={[{ value: '', label: 'Everyone' }, ...actors]}
                onChange={(actor) => setQuery({ ...query, actor: actor || null })}
              />
            </Field>
            <Field label="Module">
              <Select
                value={query.module ?? ''}
                searchable={modules.length > 8}
                options={[{ value: '', label: 'All modules' }, ...modules]}
                onChange={(module) => setQuery({ ...query, module: module || null })}
              />
            </Field>
            <Field label="When">
              <Select
                value={query.range}
                options={ranges}
                onChange={(range) => setQuery({ ...query, range })}
              />
            </Field>
          </Fields>
        </PanelBody>
      </section>

      <section className="mx-panel" aria-labelledby="audit-entries" aria-busy={pending}>
        <div className="mx-panel-head">
          <div className="mx-inline" style={{ gap: 12 }}>
            <h2 id="audit-entries">Changes and actions</h2>
            {error ? (
              <span className="mx-status mx-status-error" role="status">
                {error}
              </span>
            ) : (
              <span className="mx-sub">
                {rows.length}
                {more ? '+' : ''} {rows.length === 1 && !more ? 'entry' : 'entries'}
              </span>
            )}
          </div>
          <Seg
            label="Type"
            value={query.kind}
            options={kinds}
            onChange={(kind) => setQuery({ ...query, kind })}
            view
          />
        </div>
        {rows.map((row, index) => (
          <Entry
            key={row.id}
            row={row}
            first={index === 0}
            now={now}
            onUndone={() => markUndone(row.id)}
          />
        ))}
        {rows.length === 0 ? (
          <Empty mood="thinking">
            <div className="mx-stack" style={{ alignItems: 'center' }}>
              <span>Nothing matches these filters.</span>
              <button type="button" className="mx-btn" onClick={clear}>
                Clear filters
              </button>
            </div>
          </Empty>
        ) : null}
        {more ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '10px 16px 16px',
              borderTop: '1px solid var(--mx-line)',
            }}
          >
            <button type="button" className="mx-btn" disabled={pending} onClick={loadMore}>
              {pending ? 'Loading' : 'Load more'}
            </button>
          </div>
        ) : null}
      </section>
    </>
  );
}
