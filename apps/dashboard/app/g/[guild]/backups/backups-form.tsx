'use client';

import {
  type BackupsConfig,
  TEMPLATE_DESCRIPTION_MAX,
  TEMPLATE_TITLE_MAX,
} from '@maxwell/core/modules/backups';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Checkbox, Select, TextArea, TextInput, ToggleRow } from '@/components/controls';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { useDraft } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import { Empty, Field, Grid, Panel, PanelBody } from '@/components/ui';
import { usePoll } from '@/components/use-poll';
import { runAction } from '@/lib/actions';
import type { Key, Translator } from '@/lib/i18n';
import type { TemplateCard } from '@/lib/template-view';
import { bytes, clock, dayName, dayTime, since } from '@/lib/time';
import {
  applyTemplate,
  compareSnapshots,
  importStatus,
  listSnapshots,
  publishTemplate,
  readTemplate,
  restoreSnapshot,
  unpublishTemplate,
} from './actions';
import type { DiffItem, DiffView, ImportView, SnapshotRow, Usage } from './data';

const DAILY_GAP = 23 * 60 * 60_000;
const SHOWN = 10;
const SIGN_COLORS: Record<DiffItem['sign'], string> = {
  '+': '#2EB67D',
  '-': '#EC5B78',
  '~': '#3A9EEA',
};
const GROUPS: DiffItem['group'][] = ['Roles', 'Channels', 'Maxwell settings'];
const KEEP_DAYS = [7, 14, 30, 60, 90];
const KEEP_MANUAL = [5, 10, 20, 50];

function withCurrent(values: number[], current: number): number[] {
  return values.includes(current) ? values : [...values, current].sort((a, b) => a - b);
}

function kindText(t: Translator, snapshot: SnapshotRow): string {
  if (snapshot.kind === 'daily') return t('Daily');
  if (snapshot.label) return t.raw(snapshot.label);
  return snapshot.by ? t('Manual, by {name}', { name: snapshot.by }) : t('Manual');
}

function counts(t: Translator, snapshot: SnapshotRow): string {
  const parts = [
    t('{n, plural, one {# role} other {# roles}}', { n: snapshot.roleCount }),
    t('{n, plural, one {# channel} other {# channels}}', { n: snapshot.channelCount }),
  ];
  if (snapshot.moduleCount > 0) {
    parts.push(t('{n, plural, one {# module} other {# modules}}', { n: snapshot.moduleCount }));
  }
  return parts.join(', ');
}

const DIVIDER = { borderTop: '1px solid var(--mx-line)' } as const;

function DiffLine({ item }: { item: DiffItem }) {
  return (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
      <span
        className="mx-mono"
        aria-hidden="true"
        style={{ width: 12, fontWeight: 600, color: SIGN_COLORS[item.sign] }}
      >
        {item.sign === '-' ? '−' : item.sign}
      </span>
      <span className="mx-row-main">
        <span>{item.label}</span>
        {item.detail ? <span className="mx-sub">{item.detail}</span> : null}
      </span>
    </span>
  );
}

function Stats({
  newest,
  usage,
  daily,
  enabled,
  now,
}: {
  newest: SnapshotRow;
  usage: Usage;
  daily: boolean;
  enabled: boolean;
  now: string;
}) {
  const { timezone } = useGuild();
  const t = useT();
  let next: [string, string];
  if (!enabled || !daily) {
    next = [t('Off'), t('No daily snapshots')];
  } else if (usage.lastDaily) {
    const at = new Date(
      Math.max(new Date(usage.lastDaily).getTime() + DAILY_GAP, new Date(now).getTime()),
    ).toISOString();
    next = [clock(at, timezone), dayName(t, at, now, timezone)];
  } else {
    next = [t('Soon'), t('Within the hour')];
  }
  const stats: [string, string, string][] = [
    [
      t('Last snapshot'),
      since(t, new Date(now).getTime() - new Date(newest.createdAt).getTime()),
      dayTime(t, newest.createdAt, now, timezone),
    ],
    [t('Next'), next[0], next[1]],
    [t('Kept'), t.count(usage.count), usage.count === 1 ? t('Snapshot') : t('Snapshots')],
    [t('Size'), bytes(t, usage.bytes), t('All snapshots')],
  ];
  return (
    <div
      className="mx-panel"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
    >
      {stats.map(([label, value, sub]) => (
        <div key={label} className="mx-stat">
          <span className="mx-stat-label">{label}</span>
          <span className="mx-stat-value">{value}</span>
          <span className="mx-sub">{sub}</span>
        </div>
      ))}
    </div>
  );
}

const TOGGLES: [
  'snapshotBeforeRestore' | 'includeModules' | 'undoDeletions' | 'memberRoles',
  Key,
][] = [
  ['snapshotBeforeRestore', 'Snapshot before every restore'],
  ['includeModules', 'Include Maxwell settings'],
  ['undoDeletions', 'Offer undo for deleted roles and channels'],
  ['memberRoles', 'Give restored roles back to their members'],
];

function Snapshots({
  snapshots,
  oldId,
  newId,
  pick,
  onSnapshot,
  busy,
  status,
  now,
  wide,
}: {
  snapshots: SnapshotRow[];
  oldId: string | null;
  newId: string | null;
  pick: (side: 'old' | 'new', id: string) => void;
  onSnapshot: () => void;
  busy: 'idle' | 'taking' | 'saved';
  status: Status;
  now: string;
  wide: boolean;
}) {
  const { timezone } = useGuild();
  const t = useT();
  const { value, set, readOnly } = useDraft<BackupsConfig>();
  const [all, setAll] = useState(false);
  const shown = all ? snapshots : snapshots.slice(0, SHOWN);
  const empty = snapshots.length === 0;
  const button = readOnly ? null : (
    <button
      type="button"
      className="mx-btn mx-btn-primary"
      disabled={busy === 'taking'}
      onClick={onSnapshot}
    >
      {busy === 'taking'
        ? t('Taking snapshot')
        : busy === 'saved'
          ? t('Snapshot saved')
          : t('Snapshot now')}
    </button>
  );

  return (
    <Panel title={t('Snapshots')} id="snaps" span={wide ? 12 : 5} actions={empty ? null : button}>
      {empty ? (
        <Empty mood="sleeping">
          <div className="mx-stack" style={{ alignItems: 'center' }}>
            <span>{t('No snapshots yet.')}</span>
            {button}
            <StatusText status={status} />
          </div>
        </Empty>
      ) : status ? (
        <PanelBody>
          <StatusText status={status} />
        </PanelBody>
      ) : null}
      {shown.map((snapshot) => {
        const isOld = snapshot.id === oldId;
        const isNew = snapshot.id === newId;
        const when = dayTime(t, snapshot.createdAt, now, timezone);
        return (
          <div
            key={snapshot.id}
            className="mx-row"
            style={isOld || isNew ? { background: 'var(--mx-inset)' } : undefined}
          >
            <span className="mx-mono mx-muted" style={{ minWidth: 28 }}>
              #{snapshot.number}
            </span>
            <div className="mx-row-main">
              <span className="mx-row-title">{when}</span>
              <span className="mx-sub">{`${kindText(t, snapshot)}, ${counts(t, snapshot)}`}</span>
            </div>
            <div className="mx-seg" role="group" aria-label={t('Compare {when}', { when })}>
              <button type="button" aria-pressed={isOld} onClick={() => pick('old', snapshot.id)}>
                {t('Old')}
              </button>
              <button type="button" aria-pressed={isNew} onClick={() => pick('new', snapshot.id)}>
                {t('New')}
              </button>
            </div>
          </div>
        );
      })}
      {snapshots.length > SHOWN ? (
        <div className="mx-row">
          <button type="button" className="mx-btn mx-btn-ghost" onClick={() => setAll(!all)}>
            {all ? t('Show fewer') : t('Show {count} more', { count: snapshots.length - SHOWN })}
          </button>
        </div>
      ) : null}
      <div className="mx-panel-body" style={DIVIDER}>
        <div
          className="mx-fields"
          style={wide ? undefined : { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
        >
          <Field label={t('Schedule')}>
            <Select
              value={value.daily ? 'daily' : 'off'}
              options={[
                { value: 'daily', label: t('Daily') },
                { value: 'off', label: t('Only manual') },
              ]}
              onChange={(next) => set({ daily: next === 'daily' })}
            />
          </Field>
          <Field label={t('Keep daily')}>
            <Select
              value={String(value.retentionDays)}
              options={withCurrent(KEEP_DAYS, value.retentionDays).map((days) => ({
                value: String(days),
                label: t('{n, plural, one {# day} other {# days}}', { n: days }),
              }))}
              onChange={(next) => set({ retentionDays: Number(next) })}
            />
          </Field>
          <Field label={t('Keep manual')}>
            <Select
              value={String(value.maxManual)}
              options={withCurrent(KEEP_MANUAL, value.maxManual).map((count) => ({
                value: String(count),
                label: t('Last {count}', { count }),
              }))}
              onChange={(next) => set({ maxManual: Number(next) })}
            />
          </Field>
        </div>
        <div className="mx-stack" style={{ gap: 10 }}>
          {TOGGLES.map(([key, title]) => (
            <ToggleRow
              key={key}
              order
              title={t(title)}
              checked={value[key]}
              onChange={(next) => set({ [key]: next } as Partial<BackupsConfig>)}
            />
          ))}
        </div>
      </div>
    </Panel>
  );
}

function Changes({
  diff,
  names,
  loading,
  enabled,
}: {
  diff: DiffView | null;
  names: { old: string; new: string };
  loading: boolean;
  enabled: boolean;
}) {
  const { guildId } = useGuild();
  const t = useT();
  const { readOnly } = useDraft<BackupsConfig>();
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const [seen, setSeen] = useState(diff);

  if (seen !== diff) {
    setSeen(diff);
    setUnchecked(new Set());
    setStatus(null);
  }

  const items = diff?.items ?? [];
  const restorable = items.filter((item) => item.restore !== null);
  const chosen = restorable.filter((item) => !unchecked.has(item.key));

  const restore = (all: boolean) => {
    if (!diff) return;
    if (!enabled) {
      setStatus({ message: t('Turn Backups on first.'), error: true });
      return;
    }
    start(async () => {
      const pick = all
        ? null
        : {
            roles: chosen.flatMap((item) =>
              item.restore?.kind === 'role' ? [item.restore.id] : [],
            ),
            channels: chosen.flatMap((item) =>
              item.restore?.kind === 'channel' ? [item.restore.id] : [],
            ),
            modules: chosen.flatMap((item) =>
              item.restore?.kind === 'module' ? [item.restore.id] : [],
            ),
          };
      const result = await restoreSnapshot(guildId, diff.oldId, pick);
      setStatus(
        result.ok
          ? { message: t('Restoring now. Undo it in the audit trail.'), error: false }
          : { message: result.error, error: true },
      );
    });
  };

  return (
    <section
      className="mx-panel mx-s7"
      aria-labelledby="diff-title"
      aria-busy={loading}
      style={{ opacity: loading ? 0.6 : 1 }}
    >
      <div className="mx-panel-head">
        <h2 id="diff-title">
          {diff
            ? t('Changes from {old} to {new}', { old: names.old, new: names.new })
            : t('Changes')}
        </h2>
        {diff ? (
          <span className="mx-sub">
            {t('{n, plural, one {# change} other {# changes}}', { n: items.length })}
          </span>
        ) : null}
      </div>
      {diff && items.length === 0 ? (
        <Empty mood="neutral">{t('Nothing changed between these two.')}</Empty>
      ) : null}
      {GROUPS.map((group) => {
        const list = items.filter((item) => item.group === group);
        if (list.length === 0) return null;
        return (
          <div key={group} className="mx-panel-body" style={{ ...DIVIDER, gap: 8 }}>
            <span className="mx-label">{t(group)}</span>
            {list.map((item) =>
              item.restore ? (
                <Checkbox
                  key={item.key}
                  checked={!unchecked.has(item.key)}
                  disabled={readOnly}
                  label={<DiffLine item={item} />}
                  onChange={(next) =>
                    setUnchecked((previous) => {
                      const copy = new Set(previous);
                      if (next) copy.delete(item.key);
                      else copy.add(item.key);
                      return copy;
                    })
                  }
                />
              ) : (
                <span key={item.key} className="mx-check" style={{ cursor: 'default' }}>
                  <span style={{ width: 18, flexShrink: 0 }} />
                  <DiffLine item={item} />
                </span>
              ),
            )}
          </div>
        );
      })}
      {diff ? (
        <div className="mx-panel-body" style={DIVIDER}>
          <div className="mx-between">
            {status ? (
              <StatusText status={status} />
            ) : (
              <span className="mx-sub">
                {restorable.length > 0
                  ? t('{chosen} of {total} selected', {
                      chosen: chosen.length,
                      total: restorable.length,
                    })
                  : t('Nothing here can be brought back')}
              </span>
            )}
            {readOnly ? null : (
              <div className="mx-inline">
                <TwoStep
                  label={t('Restore everything from {name}', { name: names.old })}
                  disabled={pending}
                  run={() => restore(true)}
                />
                <button
                  type="button"
                  className="mx-btn mx-btn-primary"
                  disabled={pending || chosen.length === 0}
                  onClick={() => restore(false)}
                >
                  {t('Restore selected')}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Import({
  initial,
  initialLink,
  guildName,
  enabled,
  span,
}: {
  initial: ImportView | null;
  initialLink: string | null;
  guildName: string;
  enabled: boolean;
  span: 7 | 12;
}) {
  const { guildId } = useGuild();
  const t = useT();
  const { readOnly } = useDraft<BackupsConfig>();
  const [link, setLink] = useState(initialLink ?? '');
  const started = useRef(false);
  const [view, setView] = useState<ImportView | null>(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const poll = usePoll();

  const watch = (
    id: string,
    until: (next: ImportView) => boolean,
    done: (next: ImportView) => void,
  ) =>
    poll(
      async () => {
        const result = await importStatus(guildId, id);
        if (!result.ok || !result.data) return false;
        if (!until(result.data)) return false;
        setBusy(false);
        done(result.data);
        return true;
      },
      () => {
        setBusy(false);
        setStatus({
          message: t('Maxwell has not answered yet. Try again in a moment.'),
          error: true,
        });
      },
      40,
    );

  const read = (input = link) => {
    if (!enabled) {
      setStatus({ message: t('Turn Backups on first.'), error: true });
      return;
    }
    setBusy(true);
    setStatus(null);
    setView(null);
    readTemplate(guildId, input).then((result) => {
      if (!result.ok || !result.data) {
        setBusy(false);
        setStatus({ message: result.ok ? t('That did not work.') : result.error, error: true });
        return;
      }
      watch(
        result.data.id,
        (next) => next.status !== 'pending',
        (next) => {
          if (next.status === 'failed') {
            setStatus({
              message: next.error ?? t('That template could not be read.'),
              error: true,
            });
            return;
          }
          setView(next);
        },
      );
    });
  };

  useEffect(() => {
    if (started.current || !initialLink) return;
    started.current = true;
    if (readOnly) return;
    read(initialLink);
  });

  const apply = () => {
    if (!view) return;
    setBusy(true);
    setStatus(null);
    applyTemplate(guildId, view.id).then((result) => {
      if (!result.ok) {
        setBusy(false);
        setStatus({ message: result.error, error: true });
        return;
      }
      watch(
        view.id,
        (next) => next.status === 'applied' || next.status === 'failed',
        (next) => {
          setView(null);
          const created = next.created;
          if (next.status === 'failed') {
            setStatus({ message: next.error ?? t('The import stopped partway.'), error: true });
          } else if (created) {
            const parts = [
              t('Created {roles} and {channels}.', {
                roles: t('{n, plural, one {# role} other {# roles}}', { n: created.roles }),
                channels: t('{n, plural, one {# channel} other {# channels}}', {
                  n: created.channels,
                }),
              }),
            ];
            if (created.failed > 0) parts.push(t('{count} failed.', { count: created.failed }));
            parts.push(t('Undo it in the audit trail.'));
            setStatus({ message: parts.join(' '), error: false });
          }
        },
      );
    });
  };

  const stats: [string, number][] = view
    ? [
        [t('Roles'), view.roles],
        [t('Categories'), view.categories],
        [t('Channels'), view.channels],
        [t('Overwrites'), view.overwrites],
      ]
    : [];

  return (
    <Panel
      title={t('Import a template')}
      id="import"
      span={span}
      actions={
        <Link href="/templates" className="mx-btn mx-btn-ghost">
          {t('Browse templates')}
        </Link>
      }
    >
      <PanelBody>
        <div className="mx-inline">
          <input
            className="mx-input mx-mono"
            style={{ flex: '1 1 360px', width: 'auto' }}
            aria-label={t('Template link')}
            placeholder="https://discord.new/..."
            value={link}
            maxLength={200}
            readOnly={readOnly}
            onChange={(event) => setLink(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !readOnly && !busy && link.trim()) read();
            }}
          />
          {readOnly ? null : (
            <button
              type="button"
              className="mx-btn"
              disabled={busy || link.trim().length === 0}
              onClick={() => read()}
            >
              {busy && !view ? t('Reading') : t('Read template')}
            </button>
          )}
        </div>
        <StatusText status={status} />
        {view ? (
          <div className="mx-inset">
            {view.name || view.skipped > 0 ? (
              <div className="mx-row-main" style={{ padding: '12px 14px 0' }}>
                {view.name ? <span className="mx-row-title">{view.name}</span> : null}
                {view.skipped > 0 ? (
                  <span className="mx-sub">
                    {t('{n, plural, one {# item skipped} other {# items skipped}}', {
                      n: view.skipped,
                    })}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              }}
            >
              {stats.map(([label, count]) => (
                <div key={label} className="mx-stat">
                  <span className="mx-stat-label">{label}</span>
                  <span className="mx-stat-value" style={{ fontSize: 18 }}>
                    {t.count(count)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mx-between" style={{ padding: '10px 14px 14px', ...DIVIDER }}>
              <span className="mx-sub">{t('Messages and members are not part of a template')}</span>
              {readOnly ? null : (
                <TwoStep
                  primary
                  label={busy ? t('Importing') : t('Import into {name}', { name: guildName })}
                  disabled={busy}
                  run={apply}
                />
              )}
            </div>
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

function Publish({
  snapshots,
  initial,
  span,
  now,
}: {
  snapshots: SnapshotRow[];
  initial: TemplateCard[];
  span: 5 | 12;
  now: string;
}) {
  const { guildId, timezone } = useGuild();
  const t = useT();
  const { readOnly } = useDraft<BackupsConfig>();
  const [published, setPublished] = useState(initial);
  const [snapshotId, setSnapshotId] = useState(snapshots[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [showName, setShowName] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const chosen = snapshots.some((snapshot) => snapshot.id === snapshotId)
    ? snapshotId
    : (snapshots[0]?.id ?? '');

  const publish = () => {
    start(async () => {
      const result = await publishTemplate(guildId, {
        snapshotId: chosen,
        title,
        description,
        showName,
      });
      if (!result.ok || !result.data) {
        setStatus({ message: result.ok ? t('That did not work.') : result.error, error: true });
        return;
      }
      const card = result.data;
      setPublished((list) => [card, ...list]);
      setTitle('');
      setDescription('');
      setStatus({ message: t('Published.'), error: false });
    });
  };

  const unpublish = (id: string) => {
    start(async () => {
      const result = await unpublishTemplate(guildId, id);
      if (!result.ok) {
        setStatus({ message: result.error, error: true });
        return;
      }
      setPublished((list) => list.filter((card) => card.id !== id));
      setStatus({ message: t('Unpublished.'), error: false });
    });
  };

  return (
    <Panel title={t('Publish as template')} id="publish" span={span}>
      {readOnly ? (
        published.length === 0 ? (
          <PanelBody>
            <span className="mx-sub">{t('Nothing published yet.')}</span>
          </PanelBody>
        ) : null
      ) : snapshots.length === 0 ? (
        <PanelBody>
          <span className="mx-sub">{t('Take a snapshot first.')}</span>
        </PanelBody>
      ) : (
        <PanelBody>
          <Field label={t('Snapshot')}>
            <Select
              value={chosen}
              options={snapshots.map((snapshot) => ({
                value: snapshot.id,
                label: `#${snapshot.number} ${dayTime(t, snapshot.createdAt, now, timezone)}`,
                hint: counts(t, snapshot),
              }))}
              onChange={setSnapshotId}
            />
          </Field>
          <Field label={t('Title')} aside={`${title.length}/${TEMPLATE_TITLE_MAX}`}>
            <TextInput value={title} onChange={setTitle} maxLength={TEMPLATE_TITLE_MAX} />
          </Field>
          <Field
            label={t('Description')}
            aside={`${description.length}/${TEMPLATE_DESCRIPTION_MAX}`}
          >
            <TextArea
              value={description}
              onChange={setDescription}
              maxLength={TEMPLATE_DESCRIPTION_MAX}
            />
          </Field>
          <Checkbox
            checked={showName}
            onChange={setShowName}
            label={t('Show the community name')}
          />
          <div className="mx-between">
            <span className="mx-sub">
              {t('Only roles, channels and permissions. No members, messages or settings.')}
            </span>
            <button
              type="button"
              className="mx-btn mx-btn-primary"
              disabled={pending || !chosen || title.trim().length === 0}
              onClick={publish}
            >
              {t('Publish')}
            </button>
          </div>
          <StatusText status={status} />
        </PanelBody>
      )}
      {published.map((card) => (
        <div key={card.id} className="mx-row">
          <div className="mx-row-main">
            <Link href={`/templates/${card.id}`} className="mx-row-title">
              {card.title}
            </Link>
            <span className="mx-sub">
              {t('{n, plural, one {Used # time} other {Used # times}}', { n: card.uses })}
            </span>
          </div>
          {readOnly ? null : (
            <TwoStep
              ghost
              label={t('Unpublish')}
              ariaLabel={t('Unpublish {name}', { name: card.title })}
              disabled={pending}
              run={() => unpublish(card.id)}
            />
          )}
        </div>
      ))}
    </Panel>
  );
}

export function BackupsForm({
  snapshots: initialSnapshots,
  usage: initialUsage,
  diff: initialDiff,
  pending,
  templateLink,
  published,
  enabled,
  guildName,
  now,
}: {
  snapshots: SnapshotRow[];
  usage: Usage;
  diff: DiffView | null;
  pending: ImportView | null;
  templateLink: string | null;
  published: TemplateCard[];
  enabled: boolean;
  guildName: string;
  now: string;
}) {
  const { guildId, timezone } = useGuild();
  const t = useT();
  const { value } = useDraft<BackupsConfig>();
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const [usage, setUsage] = useState(initialUsage);
  const [diff, setDiff] = useState(initialDiff);
  const [oldId, setOldId] = useState(initialDiff?.oldId ?? null);
  const [newId, setNewId] = useState(initialDiff?.newId ?? null);
  const [busy, setBusy] = useState<'idle' | 'taking' | 'saved'>('idle');
  const [status, setStatus] = useState<Status>(null);
  const [loading, startCompare] = useTransition();
  const poll = usePoll();

  const nameOf = (id: string | null) => {
    const snapshot = snapshots.find((entry) => entry.id === id);
    return snapshot ? dayTime(t, snapshot.createdAt, now, timezone) : '';
  };

  const pick = (side: 'old' | 'new', id: string) => {
    const nextOld = side === 'old' ? id : oldId;
    const nextNew = side === 'new' ? id : newId;
    if (side === 'old') setOldId(id);
    else setNewId(id);
    if (!nextOld || !nextNew || nextOld === nextNew) return;
    startCompare(async () => {
      const result = await compareSnapshots(guildId, nextOld, nextNew);
      if (result.ok && result.data) setDiff(result.data);
    });
  };

  const snapshot = () => {
    if (!enabled) {
      setStatus({ message: t('Turn Backups on first.'), error: true });
      return;
    }
    setBusy('taking');
    setStatus(null);
    const before = snapshots[0]?.id ?? null;
    runAction(guildId, 'backups', 'snapshot').then((result) => {
      if (!result.ok) {
        setBusy('idle');
        setStatus({ message: result.error, error: true });
        return;
      }
      poll(
        async () => {
          const next = await listSnapshots(guildId);
          if (!next.ok || !next.data) return false;
          const latest = next.data.snapshots[0];
          if (!latest || latest.id === before) return false;
          setSnapshots(next.data.snapshots);
          setUsage(next.data.usage);
          setBusy('saved');
          setNewId(latest.id);
          if (before) {
            setOldId(before);
            startCompare(async () => {
              const compared = await compareSnapshots(guildId, before, latest.id);
              if (compared.ok && compared.data) setDiff(compared.data);
            });
          }
          return true;
        },
        () => {
          setBusy('idle');
          setStatus({
            message: t('The snapshot is taking long. Check back in a minute.'),
            error: true,
          });
        },
        40,
      );
    });
  };

  return (
    <div className="mx-stack" style={{ gap: 16 }}>
      {snapshots[0] ? (
        <Stats
          newest={snapshots[0]}
          usage={usage}
          daily={value.daily}
          enabled={enabled}
          now={now}
        />
      ) : null}
      <Grid>
        <Snapshots
          wide={diff === null}
          snapshots={snapshots}
          oldId={oldId}
          newId={newId}
          pick={pick}
          onSnapshot={snapshot}
          busy={busy}
          status={status}
          now={now}
        />
        {diff ? (
          <Changes
            diff={diff}
            names={{ old: nameOf(diff.oldId), new: nameOf(diff.newId) }}
            loading={loading}
            enabled={enabled}
          />
        ) : null}
        <Import
          initial={pending}
          initialLink={templateLink}
          guildName={guildName}
          enabled={enabled}
          span={diff ? 7 : 12}
        />
        <Publish snapshots={snapshots} initial={published} span={diff ? 5 : 12} now={now} />
      </Grid>
    </div>
  );
}
