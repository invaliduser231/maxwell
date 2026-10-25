'use client';

import type { GiveawaysConfig } from '@maxwell/core/modules/giveaways';
import { formatLocalDateTime, fromLocal, parseLocalDateTime } from '@maxwell/core/stores/scheduler';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  AddPicker,
  ChannelSelect,
  NumberInput,
  RoleSelect,
  Seg,
  TextArea,
  TextInput,
  ToggleRow,
  useRoleOptions,
} from '@/components/controls';
import { useChannelName, useGuild, useRoleName } from '@/components/guild';
import { EmbedPreview, MessagePreview } from '@/components/message-preview';
import { useDraft } from '@/components/module-shell';
import { failed, type Status, StatusText, sorted } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import { Field, Fields, Grid, Panel, PanelBody, roleColor } from '@/components/ui';
import { runAction } from '@/lib/actions';
import { DAY, duration, fullDate, plural, relative } from '@/lib/time';

interface Active {
  id: string;
  number: number;
  prize: string;
  channelId: string;
  status: 'scheduled' | 'running' | 'ended' | 'cancelled';
  startsAt: string;
  endsAt: string;
  entries: number;
  winners: number;
  requiredRoleId: string | null;
  excludedRoleId: string | null;
  minLevel: number;
  minMemberDays: number;
}

interface Ended {
  id: string;
  number: number;
  prize: string;
  endedAt: string;
  entries: number;
  winners: string[];
  winnerCount: number;
  planned: number;
}

const MAX_LENGTH = 60 * DAY;

const starts = [
  { value: 'now', label: 'Now' },
  { value: 'later', label: 'Later' },
] as const;

const endModes = [
  { value: 'after', label: 'After' },
  { value: 'at', label: 'At' },
] as const;

function localMs(value: string, timezone: string): number {
  const local = parseLocalDateTime(value);
  return local ? fromLocal(local, timezone) : Number.NaN;
}

function entryCount(n: number): string {
  return n === 1 ? '1 entry' : `${n.toLocaleString('en-US')} entries`;
}

function names(list: readonly string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

function useJob() {
  const { guildId } = useGuild();
  const router = useRouter();
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const run = (
    key: string,
    note: string,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<string | null> =>
    new Promise((resolve) =>
      start(async () => {
        setError(null);
        if (note) setBusy((current) => ({ ...current, [key]: note }));
        const result = await runAction(guildId, 'giveaways', action, payload);
        if (!result.ok) {
          setBusy((current) => {
            const { [key]: _, ...rest } = current;
            return rest;
          });
          setError(result.error);
          resolve(result.error);
          return;
        }
        setTimeout(() => router.refresh(), 2500);
        resolve(null);
      }),
    );
  return { busy, error, run };
}

function ActivePanel({ active, now }: { active: Active[]; now: number }) {
  const channelName = useChannelName();
  const roleName = useRoleName();
  const readOnly = useDraft<GiveawaysConfig>().readOnly;
  const { busy, error, run } = useJob();
  const running = active.filter((item) => item.status === 'running').length;
  const planned = active.length - running;
  const summary = [running ? `${running} running` : '', planned ? `${planned} planned` : '']
    .filter(Boolean)
    .join(', ');

  return (
    <Panel
      title="Running and planned"
      actions={
        <>
          <StatusText status={error ? failed(error) : null} />
          {summary ? <span className="mx-sub">{summary}</span> : null}
        </>
      }
    >
      <div className="mx-scroll">
        <table className="mx-table">
          <thead>
            <tr>
              <th scope="col">Prize</th>
              <th scope="col">Channel</th>
              <th scope="col">Ends</th>
              <th scope="col">Entries</th>
              <th scope="col">Winners</th>
              <th scope="col">Requirements</th>
              <th scope="col">
                <span className="mx-sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {active.map((item) => {
              const scheduled = item.status === 'scheduled';
              const requirements = [
                item.requiredRoleId ? roleName(item.requiredRoleId) : '',
                item.excludedRoleId ? `Not ${roleName(item.excludedRoleId)}` : '',
                item.minLevel > 0 ? `Level ${item.minLevel}` : '',
                item.minMemberDays > 0 ? plural(item.minMemberDays, 'day') : '',
              ].filter(Boolean);
              return (
                <tr key={item.id}>
                  <td>
                    <span className="mx-mono mx-muted">#{item.number}</span>{' '}
                    <span style={{ fontWeight: 600 }}>{item.prize}</span>
                    {scheduled ? (
                      <span className="mx-chip" style={{ marginLeft: 8 }}>
                        Planned
                      </span>
                    ) : null}
                  </td>
                  <td>{channelName(item.channelId)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {scheduled
                      ? `starts ${relative(item.startsAt, now)}`
                      : relative(item.endsAt, now)}
                  </td>
                  <td>{item.entries.toLocaleString('en-US')}</td>
                  <td>{item.winners}</td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {requirements.length === 0 ? (
                        <span className="mx-sub">None</span>
                      ) : (
                        requirements.map((entry) => (
                          <span key={entry} className="mx-chip">
                            {entry}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {busy[item.id] ? (
                      <span className="mx-sub">{busy[item.id]}</span>
                    ) : readOnly ? null : (
                      <>
                        {scheduled ? null : (
                          <TwoStep
                            label="End now"
                            ghost
                            confirm="Click again to end"
                            run={() => run(item.id, 'Ending', 'end', { giveawayId: item.id })}
                          />
                        )}
                        <TwoStep
                          label="Cancel"
                          ghost
                          confirm="Click again to cancel"
                          run={() => run(item.id, 'Cancelling', 'cancel', { giveawayId: item.id })}
                        />
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

interface Draft {
  prize: string;
  description: string;
  channelId: string | null;
  winners: number;
  endMode: 'after' | 'at';
  days: number;
  hours: number;
  minutes: number;
  endsAt: string;
  later: boolean;
  startsAt: string;
  requiredRoleId: string | null;
  excludedRoleId: string | null;
  minLevel: number;
  minMemberDays: number;
  bonus: { roleId: string; entries: number }[];
  pingRoleId: string | null;
  dmWinners: boolean;
}

function FieldError({ text }: { text: string | null }) {
  return text ? <span className="mx-field-error">{text}</span> : null;
}

function timing(form: Draft, timezone: string, now: number) {
  const start = form.later ? localMs(form.startsAt, timezone) : now;
  const length = ((form.days * 24 + form.hours) * 60 + form.minutes) * 60;
  const end = form.endMode === 'at' ? localMs(form.endsAt, timezone) : start + length * 1000;
  return { start, end, length };
}

function extrasSet(form: Draft): number {
  return [
    form.description.trim(),
    form.requiredRoleId,
    form.excludedRoleId,
    form.minLevel > 0,
    form.minMemberDays > 0,
    form.bonus.length > 0,
    form.pingRoleId,
  ].filter(Boolean).length;
}

function NewGiveaway({
  form,
  setForm,
  now,
}: {
  form: Draft;
  setForm: (patch: Partial<Draft>) => void;
  now: number;
}) {
  const { readOnly } = useDraft<GiveawaysConfig>();
  const { roles, timezone } = useGuild();
  const { run } = useJob();
  const roleOptions = useRoleOptions();
  const [status, setStatus] = useState<Status>(null);
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [more, setMore] = useState(false);
  const { start, end, length } = timing(form, timezone, Date.now());
  const errors = {
    prize: form.prize.trim() ? null : 'Name the prize.',
    channel: form.channelId ? null : 'Pick a channel.',
    winners:
      Number.isInteger(form.winners) && form.winners >= 1 && form.winners <= 50
        ? null
        : 'Pick 1 to 50 winners.',
    start:
      form.later && (!Number.isFinite(start) || start <= Date.now())
        ? 'Pick a start in the future.'
        : null,
    end: !Number.isFinite(end)
      ? 'Pick an end time.'
      : end - start < 60_000
        ? form.endMode === 'at'
          ? 'Pick an end at least a minute after the start.'
          : 'Run it for at least a minute.'
        : end - start > MAX_LENGTH
          ? 'Giveaways can run for 60 days at most.'
          : null,
  };
  const shown = tried
    ? errors
    : { prize: null, channel: null, winners: null, start: null, end: null };
  const bonusOptions = roleOptions.filter(
    (option) => !form.bonus.some((entry) => entry.roleId === option.value),
  );
  const extras = extrasSet(form);

  const startGiveaway = async () => {
    setTried(true);
    setStatus(null);
    if (Object.values(errors).some(Boolean)) return;
    setPending(true);
    const failure = await run('new', '', 'start', {
      channelId: form.channelId,
      prize: form.prize.trim(),
      description: form.description.trim() || null,
      winners: form.winners,
      ...(form.endMode === 'at'
        ? { endsAt: new Date(end).toISOString() }
        : { durationSeconds: length }),
      ...(form.later ? { startsAt: new Date(start).toISOString() } : {}),
      requiredRoleId: form.requiredRoleId,
      excludedRoleId: form.excludedRoleId,
      minLevel: form.minLevel,
      minMemberDays: form.minMemberDays,
      bonus: form.bonus,
      pingRoleId: form.pingRoleId,
      dmWinners: form.dmWinners,
    });
    setPending(false);
    if (failure === null) {
      setForm({ prize: '', description: '' });
      setTried(false);
      setStatus(sorted(form.later ? 'Planned.' : 'Starting.'));
    } else {
      setStatus(failed(failure));
    }
  };

  return (
    <Panel
      title="New giveaway"
      span={7}
      actions={
        readOnly ? null : (
          <>
            <StatusText status={status} />
            <button
              type="button"
              className="mx-btn mx-btn-primary"
              disabled={pending}
              onClick={startGiveaway}
            >
              {form.later ? 'Plan' : 'Start'}
            </button>
          </>
        )
      }
    >
      <PanelBody>
        <Fields>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Prize">
              <TextInput
                value={form.prize}
                maxLength={256}
                onChange={(prize) => {
                  setForm({ prize });
                  setStatus(null);
                }}
              />
              <FieldError text={shown.prize} />
            </Field>
          </div>
          <Field label="Channel">
            <ChannelSelect
              value={form.channelId}
              none={null}
              onChange={(channelId) => setForm({ channelId })}
            />
            <FieldError text={shown.channel} />
          </Field>
          <Field label="Winners">
            <NumberInput
              value={form.winners}
              min={1}
              max={50}
              onChange={(winners) => setForm({ winners: Math.round(winners) })}
            />
            <FieldError text={shown.winners} />
          </Field>
          <div className="mx-field mx-field-wide">
            <span className="mx-label">Start</span>
            <div className="mx-when">
              <Seg
                label="Start"
                value={form.later ? 'later' : 'now'}
                options={starts}
                onChange={(next) =>
                  setForm({
                    later: next === 'later',
                    startsAt: form.startsAt || formatLocalDateTime(now + DAY, timezone),
                  })
                }
              />
              {form.later ? (
                <input
                  type="datetime-local"
                  className="mx-input"
                  aria-label="Starts at"
                  value={form.startsAt}
                  readOnly={readOnly}
                  onChange={(event) => setForm({ startsAt: event.target.value })}
                />
              ) : null}
            </div>
            <FieldError text={shown.start} />
          </div>
          <div className="mx-field mx-field-wide">
            <span className="mx-label">Ends</span>
            <div className="mx-when">
              <Seg
                label="Ends"
                value={form.endMode}
                options={endModes}
                onChange={(endMode) =>
                  setForm({
                    endMode,
                    endsAt:
                      form.endsAt ||
                      formatLocalDateTime(Number.isFinite(end) ? end : now + 3 * DAY, timezone),
                  })
                }
              />
              {form.endMode === 'at' ? (
                <input
                  type="datetime-local"
                  className="mx-input"
                  aria-label="Ends at"
                  value={form.endsAt}
                  readOnly={readOnly}
                  onChange={(event) => setForm({ endsAt: event.target.value })}
                />
              ) : (
                <div className="mx-span">
                  <NumberInput
                    value={form.days}
                    min={0}
                    max={60}
                    label="Days"
                    suffix="d"
                    onChange={(days) => setForm({ days: Math.max(0, Math.round(days)) })}
                  />
                  <NumberInput
                    value={form.hours}
                    min={0}
                    max={23}
                    label="Hours"
                    suffix="h"
                    onChange={(hours) => setForm({ hours: Math.max(0, Math.round(hours)) })}
                  />
                  <NumberInput
                    value={form.minutes}
                    min={0}
                    max={59}
                    label="Minutes"
                    suffix="min"
                    onChange={(minutes) => setForm({ minutes: Math.max(0, Math.round(minutes)) })}
                  />
                </div>
              )}
            </div>
            {shown.end ? (
              <FieldError text={shown.end} />
            ) : Number.isFinite(end) && !errors.end ? (
              <span className="mx-sub">
                {form.endMode === 'at'
                  ? `Runs for ${duration(end - start)}`
                  : `Ends ${fullDate(end, timezone)}`}
              </span>
            ) : null}
          </div>
        </Fields>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <button
            type="button"
            className="mx-btn mx-btn-ghost"
            aria-expanded={more}
            onClick={() => setMore(!more)}
          >
            {more ? 'Fewer options' : 'More options'}
          </button>
          {!more && extras > 0 ? (
            <span className="mx-sub">{plural(extras, 'option')} set</span>
          ) : null}
        </div>
      </PanelBody>
      {more ? (
        <>
          <PanelBody>
            <Field label="Description">
              <TextArea
                value={form.description}
                rows={3}
                maxLength={1000}
                onChange={(description) => setForm({ description })}
              />
            </Field>
          </PanelBody>
          <div className="mx-panel-head" style={{ borderTop: '1px solid var(--mx-line)' }}>
            <h3>Who can enter</h3>
          </div>
          <PanelBody>
            <Fields>
              <Field label="Needs role">
                <RoleSelect
                  value={form.requiredRoleId}
                  none="Anyone"
                  onChange={(requiredRoleId) => setForm({ requiredRoleId })}
                />
              </Field>
              <Field label="Not for role">
                <RoleSelect
                  value={form.excludedRoleId}
                  none="Nobody excluded"
                  onChange={(excludedRoleId) => setForm({ excludedRoleId })}
                />
              </Field>
              <Field label="Minimum level">
                <NumberInput
                  value={form.minLevel}
                  min={0}
                  max={1000}
                  onChange={(minLevel) =>
                    setForm({ minLevel: Math.min(Math.max(Math.round(minLevel), 0), 1000) })
                  }
                />
              </Field>
              <Field label="Member for at least">
                <NumberInput
                  value={form.minMemberDays}
                  min={0}
                  max={3650}
                  suffix="days"
                  onChange={(minMemberDays) =>
                    setForm({
                      minMemberDays: Math.min(Math.max(Math.round(minMemberDays), 0), 3650),
                    })
                  }
                />
              </Field>
            </Fields>
          </PanelBody>
          <div className="mx-panel-head" style={{ borderTop: '1px solid var(--mx-line)' }}>
            <h3>Bonus entries</h3>
            {readOnly || form.bonus.length >= 25 || bonusOptions.length === 0 ? null : (
              <AddPicker
                label="Add role"
                options={bonusOptions}
                onPick={(roleId) => setForm({ bonus: [...form.bonus, { roleId, entries: 1 }] })}
              />
            )}
          </div>
          {form.bonus.length === 0 ? (
            <PanelBody>
              <span className="mx-sub">None</span>
            </PanelBody>
          ) : null}
          {form.bonus.map((entry) => {
            const role = roles.find((item) => item.id === entry.roleId);
            const name = role?.name ?? 'Deleted role';
            return (
              <div className="mx-row" key={entry.roleId}>
                <span className="mx-dot" style={{ background: roleColor(role?.color ?? 0) }} />
                <div className="mx-row-main">
                  <span className="mx-ellipsis">{name}</span>
                </div>
                <div style={{ width: 130, flexShrink: 0 }}>
                  <NumberInput
                    value={entry.entries}
                    min={1}
                    max={50}
                    label={`Extra entries for ${name}`}
                    suffix="extra"
                    onChange={(entries) =>
                      setForm({
                        bonus: form.bonus.map((item) =>
                          item.roleId === entry.roleId
                            ? { ...item, entries: Math.min(Math.max(entries, 1), 50) }
                            : item,
                        ),
                      })
                    }
                  />
                </div>
                {readOnly ? null : (
                  <button
                    type="button"
                    className="mx-btn mx-btn-ghost"
                    aria-label={`Remove bonus for ${name}`}
                    onClick={() =>
                      setForm({ bonus: form.bonus.filter((item) => item.roleId !== entry.roleId) })
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
          <div className="mx-panel-head" style={{ borderTop: '1px solid var(--mx-line)' }}>
            <h3>Announcing</h3>
          </div>
          <PanelBody>
            <Fields>
              <Field label="Ping when it starts">
                <RoleSelect
                  value={form.pingRoleId}
                  none="Nobody"
                  onChange={(pingRoleId) => setForm({ pingRoleId })}
                />
              </Field>
            </Fields>
            <ToggleRow
              title="Message the winners"
              checked={form.dmWinners}
              onChange={(dmWinners) => setForm({ dmWinners })}
            />
          </PanelBody>
        </>
      ) : null}
    </Panel>
  );
}

function PreviewPanel({ form, host }: { form: Draft; host: string }) {
  const channelName = useChannelName();
  const roleName = useRoleName();
  const { timezone } = useGuild();
  const { start, end } = timing(form, timezone, Date.now());
  const requirements = [
    form.requiredRoleId ? `role ${roleName(form.requiredRoleId)}` : '',
    form.minLevel > 0 ? `level ${form.minLevel}` : '',
    form.minMemberDays > 0 ? `member for ${plural(form.minMemberDays, 'day')}` : '',
  ].filter(Boolean);
  const winners = form.winners;
  const ends =
    Number.isFinite(end) && end > start ? `Ends ${fullDate(end, timezone)}.` : 'No end set.';
  return (
    <Panel
      title="Preview"
      actions={
        <span className="mx-sub">
          {form.channelId ? channelName(form.channelId) : 'No channel'}
        </span>
      }
    >
      <PanelBody>
        <div className="mx-preview">
          <MessagePreview avatarSize={30}>
            {form.pingRoleId ? <span className="mx-sub">@{roleName(form.pingRoleId)}</span> : null}
            <EmbedPreview
              color="#F26B3A"
              title={
                <span style={{ fontSize: 15, overflowWrap: 'anywhere' }}>
                  {form.prize.trim() || 'Prize'}
                </span>
              }
              description={`${form.description.trim() ? `${form.description.trim()}\n\n` : ''}${winners === 1 ? '1 winner.' : `${winners} winners.`} ${ends}`}
              footer={`Hosted by ${host}`}
            >
              <span className="mx-sub">
                {requirements.length > 0
                  ? `Requires ${requirements.join(', ')}.`
                  : 'Open to everyone.'}
              </span>
              {form.excludedRoleId ? (
                <span className="mx-sub">Not for {roleName(form.excludedRoleId)}.</span>
              ) : null}
              {form.bonus.length > 0 ? (
                <span className="mx-sub">
                  Extra entries:{' '}
                  {form.bonus
                    .map((entry) => `${roleName(entry.roleId)} +${entry.entries}`)
                    .join(', ')}
                  .
                </span>
              ) : null}
            </EmbedPreview>
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="mx-chip">Enter 0</span>
            </div>
          </MessagePreview>
        </div>
      </PanelBody>
    </Panel>
  );
}

function HistoryPanel({ history, now }: { history: Ended[]; now: number }) {
  const readOnly = useDraft<GiveawaysConfig>().readOnly;
  const { busy, error, run } = useJob();
  return (
    <Panel title="Ended" actions={<StatusText status={error ? failed(error) : null} />}>
      {history.map((item) => {
        const extra = item.winnerCount - item.winners.length;
        const won =
          item.winnerCount === 0
            ? 'Nobody won'
            : `Won by ${names(extra > 0 ? [...item.winners, plural(extra, 'other')] : item.winners)}`;
        const rerolled = item.winnerCount > item.planned ? ', rerolled' : '';
        return (
          <div className="mx-row" key={item.id}>
            <div className="mx-row-main">
              <span className="mx-row-title">
                <span className="mx-mono mx-muted">#{item.number}</span> {item.prize}
              </span>
              <span className="mx-sub">
                {won}, {entryCount(item.entries)}
                {rerolled}, {relative(item.endedAt, now)}
              </span>
            </div>
            {busy[item.id] ? (
              <span className="mx-sub">{busy[item.id]}</span>
            ) : readOnly || item.entries === 0 ? null : (
              <button
                type="button"
                className="mx-btn mx-btn-ghost"
                onClick={() => run(item.id, 'Drawing', 'reroll', { giveawayId: item.id, count: 1 })}
              >
                Reroll
              </button>
            )}
          </div>
        );
      })}
    </Panel>
  );
}

function SettingsPanel() {
  const { value, set } = useDraft<GiveawaysConfig>();
  return (
    <Panel title="Defaults">
      <PanelBody>
        <Fields>
          <Field label="Entry emoji">
            <TextInput
              value={value.emoji ?? ''}
              maxLength={100}
              placeholder="Default"
              onChange={(emoji) => set({ emoji: emoji.trim() ? emoji : null })}
            />
          </Field>
          <Field label="Ping when it starts">
            <RoleSelect
              value={value.pingRoleId}
              none="Nobody"
              onChange={(pingRoleId) => set({ pingRoleId })}
            />
          </Field>
          <Field label="Not for role">
            <RoleSelect
              value={value.excludedRoleId}
              none="Nobody excluded"
              onChange={(excludedRoleId) => set({ excludedRoleId })}
            />
          </Field>
        </Fields>
        <ToggleRow
          title="Message the winners"
          checked={value.dmWinners}
          onChange={(dmWinners) => set({ dmWinners })}
        />
      </PanelBody>
    </Panel>
  );
}

export function GiveawaysView({
  now,
  host,
  active,
  history,
}: {
  now: number;
  host: string;
  active: Active[];
  history: Ended[];
}) {
  const { value } = useDraft<GiveawaysConfig>();
  const [form, setFormState] = useState<Draft>(() => ({
    prize: '',
    description: '',
    channelId: null,
    winners: 1,
    endMode: 'after',
    days: 3,
    hours: 0,
    minutes: 0,
    endsAt: '',
    later: false,
    startsAt: '',
    requiredRoleId: value.requiredRoleId,
    excludedRoleId: value.excludedRoleId,
    minLevel: value.minLevel,
    minMemberDays: value.minMemberDays,
    bonus: value.bonusEntries,
    pingRoleId: value.pingRoleId,
    dmWinners: value.dmWinners,
  }));
  const setForm = (patch: Partial<Draft>) => setFormState((current) => ({ ...current, ...patch }));

  return (
    <>
      {active.length > 0 ? <ActivePanel active={active} now={now} /> : null}
      <Grid>
        <NewGiveaway form={form} setForm={setForm} now={now} />
        <div className="mx-s5" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <PreviewPanel form={form} host={host} />
          {history.length > 0 ? <HistoryPanel history={history} now={now} /> : null}
          <SettingsPanel />
        </div>
      </Grid>
    </>
  );
}
