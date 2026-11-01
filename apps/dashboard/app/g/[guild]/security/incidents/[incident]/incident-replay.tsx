'use client';

import { useEffect, useMemo, useState } from 'react';
import { Checkbox } from '@/components/controls';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import { Callout, Empty, Grid, Panel, PanelBody, Stat } from '@/components/ui';
import { runAction } from '@/lib/actions';
import { clock, duration, fullDate } from '@/lib/time';
import { incidentKind, replayCounts, timelineText } from '../../incident-format';
import type { IncidentDetail, UndoEntry, UndoView } from '../../incidents';

const STEP_MS = 700;
const SHOWN = 300;

type Group = keyof UndoView;

const groups: { key: Group; title: string }[] = [
  { key: 'bans', title: 'Unban' },
  { key: 'timeouts', title: 'Lift timeouts' },
  { key: 'channels', title: 'Restore channels' },
  { key: 'roles', title: 'Restore roles' },
];

function UndoGroup({
  title,
  entries,
  excluded,
  onToggle,
  prefix,
  disabled,
}: {
  title: string;
  entries: UndoEntry[];
  excluded: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  prefix: string;
  disabled: boolean;
}) {
  if (entries.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <span className="mx-label">{title}</span>
      {entries.map((entry) => (
        <Checkbox
          key={entry.id}
          checked={!excluded.has(entry.id)}
          onChange={(on) => onToggle(entry.id, on)}
          label={`${prefix}${entry.name}`}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

export function IncidentReplay({ detail, canEdit }: { detail: IncidentDetail; canEdit: boolean }) {
  const t = useT();
  const { guildId, timezone } = useGuild();
  const { incident, events, undo } = detail;
  const total = events.length;
  const [step, setStep] = useState(total);
  const [playing, setPlaying] = useState(false);
  const [excluded, setExcluded] = useState<Record<Group, Set<string>>>({
    bans: new Set(),
    timeouts: new Set(),
    channels: new Set(),
    roles: new Set(),
  });
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setStep((current) => Math.min(total, current + 1)), STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, step, total]);

  const shown = useMemo(() => events.slice(0, step), [events, step]);
  const counts = useMemo(() => replayCounts(shown), [shown]);
  const last = shown.at(-1);
  const end = incident.endedAt ?? detail.now;

  const play = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (step >= total) setStep(0);
    setPlaying(true);
  };
  const go = (next: number) => {
    setPlaying(false);
    setStep(Math.max(0, Math.min(total, next)));
  };

  const picked = (key: Group) =>
    undo[key].map((entry) => entry.id).filter((id) => !excluded[key].has(id));
  const selected = groups.reduce((sum, group) => sum + picked(group.key).length, 0);
  const available = groups.reduce((sum, group) => sum + undo[group.key].length, 0);

  const toggle = (key: Group, id: string, on: boolean) =>
    setExcluded((previous) => {
      const next = new Set(previous[key]);
      if (on) next.delete(id);
      else next.add(id);
      return { ...previous, [key]: next };
    });

  const runUndo = () => {
    setBusy(true);
    setStatus(null);
    runAction(guildId, 'security', 'incident.undo', {
      incidentId: incident.id,
      bans: picked('bans'),
      timeouts: picked('timeouts'),
      channels: picked('channels'),
      roles: picked('roles'),
    }).then((result) => {
      setBusy(false);
      setStatus(
        result.ok
          ? { message: t.raw('Sent to Maxwell.'), error: false }
          : { message: result.error, error: true },
      );
    });
  };

  return (
    <Grid>
      <div className="mx-s12">
        <Callout>
          <span className="mx-row-title">
            {incidentKind(t, incident.kind)}, {fullDate(t, incident.startedAt, timezone)}
          </span>
          <span className="mx-sub">
            {' '}
            {incident.endedAt === null
              ? t.raw('Still running')
              : t.raw('Lasted {time}', { time: duration(t, end - incident.startedAt) })}
            {incident.startedBy
              ? `, ${t.raw('started by {name}', { name: incident.startedBy })}`
              : ''}
          </span>
        </Callout>
      </div>

      <Stat label={t.raw('Joins')} value={t.count(counts.joins)} quiet />
      <Stat label={t.raw('Bans')} value={t.count(counts.bans)} quiet />
      <Stat label={t.raw('Deleted messages')} value={t.count(counts.deleted)} quiet />
      <Stat label={t.raw('AutoMod hits')} value={t.count(counts.hits)} quiet />

      <Panel
        title={t.raw('Timeline')}
        span={8}
        id="incident-timeline"
        actions={
          <span className="mx-sub">
            {t.raw('{n} of {total}', { n: step, total })}
            {last ? `, ${clock(last.at, timezone)}` : ''}
          </span>
        }
      >
        {total === 0 ? (
          <Empty mood="sleeping">{t.raw('Nothing recorded')}</Empty>
        ) : (
          <>
            <PanelBody>
              <div className="mx-inline" style={{ flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="mx-btn mx-btn-ghost"
                  disabled={step === 0}
                  onClick={() => go(0)}
                >
                  {t.raw('To the start')}
                </button>
                <button
                  type="button"
                  className="mx-btn mx-btn-ghost"
                  disabled={step === 0}
                  onClick={() => go(step - 1)}
                >
                  {t.raw('Step back')}
                </button>
                <button type="button" className="mx-btn mx-btn-primary" onClick={play}>
                  {playing ? t.raw('Pause') : t.raw('Replay')}
                </button>
                <button
                  type="button"
                  className="mx-btn mx-btn-ghost"
                  disabled={step >= total}
                  onClick={() => go(step + 1)}
                >
                  {t.raw('Step forward')}
                </button>
                <button
                  type="button"
                  className="mx-btn mx-btn-ghost"
                  disabled={step >= total}
                  onClick={() => go(total)}
                >
                  {t.raw('To the end')}
                </button>
              </div>
              <input
                type="range"
                min={0}
                max={total}
                step={1}
                value={step}
                aria-label={t.raw('Position in the timeline')}
                onChange={(event) => go(Number(event.target.value))}
                style={{ width: '100%', marginTop: 12 }}
              />
            </PanelBody>
            {shown.length === 0 ? (
              <Empty>{t.raw('Press replay to step through what happened.')}</Empty>
            ) : (
              <ol style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-live="polite">
                {shown
                  .slice(-SHOWN)
                  .reverse()
                  .map((event) => (
                    <li key={event.id} className="mx-row">
                      <span className="mx-sub mx-mono" style={{ width: 52, flexShrink: 0 }}>
                        {clock(event.at, timezone)}
                      </span>
                      <div className="mx-row-main">
                        <span className="mx-row-title">{timelineText(t, event)}</span>
                        {event.restored ? (
                          <span className="mx-sub">{t.raw('Restored from the last backup')}</span>
                        ) : null}
                      </div>
                    </li>
                  ))}
              </ol>
            )}
          </>
        )}
      </Panel>

      <Panel title={t.raw('Undo')} span={4} id="incident-undo">
        <PanelBody>
          {incident.undoneAt ? (
            <p className="mx-sub" style={{ margin: '0 0 12px' }}>
              {incident.undoneBy
                ? t.raw('Undo sent by {name} on {date}.', {
                    name: incident.undoneBy,
                    date: fullDate(t, incident.undoneAt, timezone),
                  })
                : t.raw('Undo sent on {date}.', {
                    date: fullDate(t, incident.undoneAt, timezone),
                  })}
            </p>
          ) : null}
          {available === 0 ? (
            <Empty>{t.raw('Nothing here that Maxwell can undo.')}</Empty>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {groups.map((group) => (
                <UndoGroup
                  key={group.key}
                  title={t.raw(group.title)}
                  entries={undo[group.key]}
                  excluded={excluded[group.key]}
                  onToggle={(id, on) => toggle(group.key, id, on)}
                  prefix={group.key === 'channels' ? '#' : group.key === 'roles' ? '@' : ''}
                  disabled={!canEdit}
                />
              ))}
              {canEdit ? (
                <div className="mx-inline">
                  <TwoStep
                    label={t.plural(selected, 'Undo {n} action', 'Undo {n} actions')}
                    primary
                    disabled={busy || selected === 0}
                    run={runUndo}
                  />
                  <StatusText status={status} />
                </div>
              ) : null}
            </div>
          )}
        </PanelBody>
      </Panel>
    </Grid>
  );
}
