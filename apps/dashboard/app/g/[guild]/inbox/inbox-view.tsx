'use client';

import type { InboxKind, ModerationConfig } from '@maxwell/core/modules/moderation';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ChannelSelect, Checkbox, Seg, Select, Switch } from '@/components/controls';
import { EmojiPicker } from '@/components/emoji-picker';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { useLive } from '@/components/live';
import { useDraft, useReadOnly } from '@/components/module-shell';
import { failed, type Status, StatusText } from '@/components/status-text';
import { Avatar, Empty, Field, Grid, Panel, PanelBody } from '@/components/ui';
import type { Key } from '@/lib/i18n';
import { ago, duration } from '@/lib/time';
import { reasonText } from '../security/security-form';
import { claimItem, resolveItem } from './actions';
import type { InboxDetail, InboxRow, InboxView as Mode } from './data';

type Choice = 'warn' | 'timeout' | 'kick' | 'ban' | 'close' | 'dismiss';

const kindTitles: Record<InboxKind, Key> = {
  report: 'Report #{number}',
  appeal: 'Appeal #{number}',
  review: 'Review #{number}',
  gate: 'Gate #{number}',
  check: 'Verification #{number}',
};

const kindOptions: { value: InboxKind | 'all'; label: Key }[] = [
  { value: 'all', label: 'All' },
  { value: 'report', label: 'Reports' },
  { value: 'appeal', label: 'Appeals' },
  { value: 'review', label: 'Reviews' },
  { value: 'gate', label: 'Gate' },
  { value: 'check', label: 'Verifications' },
];

const statusColors: Record<InboxRow['status'], string> = {
  open: '#F2C14E',
  claimed: '#3A9EEA',
  resolved: '#2EB67D',
  dismissed: '#8F939B',
};

const actionWords: Record<'warn' | 'timeout' | 'kick' | 'ban', Key> = {
  warn: 'Warn',
  timeout: 'Time out',
  kick: 'Kick',
  ban: 'Ban',
};

const outcomeWords: Record<string, Key> = {
  warn: 'Warned',
  timeout: 'Timed out',
  kick: 'Kicked',
  ban: 'Banned',
  unban: 'Unbanned',
  approved: 'Approved',
  declined: 'Declined',
  deleted: 'Message deleted',
  let_in: 'Let in',
  left: 'Left the server',
  passed: 'Passed the captcha',
  released: 'Let in',
  none: 'No action',
};

const checkStates: Record<string, Key> = {
  undelivered: 'The captcha could not be sent.',
  failed: 'Failed the captcha.',
  expired: 'Did not solve the captcha in time.',
};

const timeoutChoices = [10, 60, 360, 1_440, 10_080, 40_320];
const banChoices = [0, 1_440, 10_080, 43_200];

function useGo(mode: Mode, kind: InboxKind | null) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const go = (next: { mode?: Mode; kind?: InboxKind | null; item?: number | null }) => {
    const params = new URLSearchParams();
    const nextMode = next.mode ?? mode;
    const nextKind = next.kind === undefined ? kind : next.kind;
    if (nextMode !== 'active') params.set('view', nextMode);
    if (nextKind) params.set('kind', nextKind);
    if (next.item) params.set('item', String(next.item));
    const query = params.toString();
    start(() => router.push(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };
  return { go, pending };
}

function StatusChip({ row }: { row: InboxRow }) {
  const t = useT();
  const label =
    row.status === 'open'
      ? t('Open')
      : row.status === 'claimed'
        ? (row.assignee?.name ?? t('Claimed'))
        : row.status === 'resolved'
          ? t('Resolved')
          : t('Dismissed');
  return (
    <span className="mx-chip" style={{ color: statusColors[row.status] }}>
      {label}
    </span>
  );
}

function ListRow({
  row,
  selected,
  now,
  onPick,
}: {
  row: InboxRow;
  selected: boolean;
  now: string;
  onPick: () => void;
}) {
  const t = useT();
  const title = t(kindTitles[row.kind], { number: String(row.number) });
  const parts = [title, ago(t, row.createdAt, now)];
  if (row.kind === 'report' && row.reporterCount > 1) {
    parts.splice(1, 0, t('{count} reports', { count: row.reporterCount }));
  }
  return (
    <button
      type="button"
      className="mx-row mx-row-button"
      onClick={onPick}
      aria-current={selected ? 'true' : undefined}
    >
      <Avatar src={row.subject?.avatar} name={row.subject?.name ?? t('Gate')} size={30} />
      <span className="mx-row-main">
        <span className="mx-row-title mx-ellipsis">
          {row.kind === 'gate'
            ? t('Members at the gate')
            : (row.subject?.name ?? t('Unknown member'))}
        </span>
        <span className="mx-sub mx-ellipsis">{parts.join(', ')}</span>
        {row.preview ? (
          <span className="mx-sub mx-ellipsis" style={{ color: 'var(--mx-text-2)' }}>
            {row.preview}
          </span>
        ) : null}
      </span>
      <StatusChip row={row} />
    </button>
  );
}

function ResolveForm({
  detail,
  choice,
  onDone,
  onCancel,
}: {
  detail: InboxDetail;
  choice: Choice;
  onDone: (status: Status) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { guildId } = useGuild();
  const { value: config } = useDraft<ModerationConfig>();
  const action = choice === 'close' || choice === 'dismiss' ? null : choice;
  const status = choice === 'dismiss' ? 'dismissed' : 'resolved';
  const timed = action === 'timeout' || action === 'ban';
  const timeouts = timeoutChoices.includes(config.defaultTimeoutMinutes)
    ? timeoutChoices
    : [...timeoutChoices, config.defaultTimeoutMinutes].sort((a, b) => a - b);
  const [minutes, setMinutes] = useState(action === 'timeout' ? config.defaultTimeoutMinutes : 0);
  const [reason, setReason] = useState(detail.kind === 'report' ? (detail.body ?? '') : '');
  const [note, setNote] = useState('');
  const [remove, setRemove] = useState(detail.kind === 'report' && action !== null);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const needsReason = action !== null && config.requireReason && !reason.trim();
  const danger = action === 'ban' || action === 'kick';
  const name = detail.subject?.name ?? t('this member');

  const label =
    detail.kind === 'gate'
      ? choice === 'dismiss'
        ? t('Dismiss')
        : action === 'ban'
          ? t('Ban everyone waiting')
          : t('Let everyone in')
      : detail.kind === 'check' && !action && choice !== 'dismiss'
        ? t('Let {name} in', { name })
        : detail.kind === 'appeal'
          ? choice === 'dismiss'
            ? t('Decline appeal')
            : t('Accept and unban {name}', { name })
          : detail.kind === 'review'
            ? choice === 'dismiss'
              ? t('Decline')
              : t('Approve')
            : action
              ? `${t(actionWords[action])} ${name}`
              : choice === 'dismiss'
                ? t('Dismiss')
                : t('Close without action');

  return (
    <form
      className="mx-inset mx-stack"
      style={{ margin: '0 16px 14px', padding: 14 }}
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (needsReason) return;
        start(async () => {
          const result = await resolveItem(guildId, {
            number: detail.number,
            status,
            action,
            durationSeconds: timed && minutes > 0 ? minutes * 60 : null,
            reason,
            deleteMessage: remove,
            note,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          onDone({ message: 'Maxwell is on it.', error: false });
        });
      }}
    >
      {action && detail.kind !== 'gate' ? (
        <div className="mx-fields">
          <label className="mx-field" style={timed ? undefined : { gridColumn: '1 / -1' }}>
            <span className="mx-label">{t('Reason')}</span>
            <input
              className="mx-input"
              value={reason}
              maxLength={1_500}
              placeholder={config.requireReason ? undefined : t('Optional')}
              aria-invalid={tried && needsReason ? true : undefined}
              onChange={(event) => setReason(event.target.value)}
            />
            {tried && needsReason ? (
              <span className="mx-field-error">{t('Add a reason.')}</span>
            ) : null}
          </label>
          {timed ? (
            <div className="mx-field">
              <span className="mx-label">{t('How long')}</span>
              <Select
                label={t('How long')}
                value={String(minutes)}
                options={(action === 'timeout' ? timeouts : banChoices).map((value) => ({
                  value: String(value),
                  label: value === 0 ? t('Permanent') : duration(t, value * 60_000),
                }))}
                onChange={(next) => setMinutes(Number(next))}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <label className="mx-field">
        <span className="mx-label">{t('Note for the team')}</span>
        <input
          className="mx-input"
          value={note}
          maxLength={1_500}
          placeholder={t('Optional')}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {detail.kind === 'report' && detail.messageUrl && status === 'resolved' ? (
        <Checkbox checked={remove} onChange={setRemove} label={t('Delete the reported message')} />
      ) : null}
      <div className="mx-inline" style={{ justifyContent: 'flex-end' }}>
        <StatusText status={error ? failed(error) : null} />
        <button type="button" className="mx-btn mx-btn-ghost" onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button
          type="submit"
          className={danger ? 'mx-btn mx-btn-danger' : 'mx-btn mx-btn-primary'}
          disabled={pending}
        >
          {label}
        </button>
      </div>
    </form>
  );
}

function Choices({ detail, onPick }: { detail: InboxDetail; onPick: (choice: Choice) => void }) {
  const t = useT();
  if (detail.kind === 'gate' || detail.kind === 'check') {
    const gate = detail.kind === 'gate';
    return (
      <>
        <button type="button" className="mx-btn mx-btn-primary" onClick={() => onPick('close')}>
          {gate ? t('Let everyone in') : t('Let in')}
        </button>
        {gate ? null : (
          <button type="button" className="mx-btn mx-btn-danger" onClick={() => onPick('kick')}>
            {t('Kick')}
          </button>
        )}
        <button type="button" className="mx-btn mx-btn-danger" onClick={() => onPick('ban')}>
          {gate ? t('Ban everyone waiting') : t('Ban')}
        </button>
        <button type="button" className="mx-btn mx-btn-ghost" onClick={() => onPick('dismiss')}>
          {t('Dismiss')}
        </button>
      </>
    );
  }
  if (detail.kind === 'appeal') {
    return (
      <>
        <button type="button" className="mx-btn mx-btn-primary" onClick={() => onPick('close')}>
          {t('Accept')}
        </button>
        <button type="button" className="mx-btn" onClick={() => onPick('dismiss')}>
          {t('Decline')}
        </button>
      </>
    );
  }
  if (detail.kind === 'review') {
    const suggested = detail.suggested as keyof typeof actionWords | null;
    return (
      <>
        <button type="button" className="mx-btn mx-btn-primary" onClick={() => onPick('close')}>
          {suggested && actionWords[suggested]
            ? t('Approve {action}', { action: t(actionWords[suggested]).toLowerCase() })
            : t('Approve')}
        </button>
        <button type="button" className="mx-btn" onClick={() => onPick('dismiss')}>
          {t('Decline')}
        </button>
      </>
    );
  }
  return (
    <>
      {(['warn', 'timeout', 'kick', 'ban'] as const).map((action) => (
        <button
          key={action}
          type="button"
          className={action === 'ban' || action === 'kick' ? 'mx-btn mx-btn-danger' : 'mx-btn'}
          onClick={() => onPick(action)}
        >
          {t(actionWords[action])}
        </button>
      ))}
      <button type="button" className="mx-btn" onClick={() => onPick('close')}>
        {t('Close without action')}
      </button>
      <button type="button" className="mx-btn mx-btn-ghost" onClick={() => onPick('dismiss')}>
        {t('Dismiss')}
      </button>
    </>
  );
}

function DetailPanel({ detail, self, now }: { detail: InboxDetail; self: string; now: string }) {
  const t = useT();
  const { guildId } = useGuild();
  const readOnly = useReadOnly();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const active = detail.status === 'open' || detail.status === 'claimed';
  const mine = detail.status === 'claimed' && detail.assignee?.id === self;
  const bodyLabel: Key =
    detail.kind === 'appeal' ? 'Appeal' : detail.kind === 'review' ? 'Reason' : 'Report';

  const claim = (next: boolean) =>
    start(async () => {
      const result = await claimItem(guildId, detail.number, next);
      setStatus(result.ok ? { message: 'Maxwell is on it.', error: false } : failed(result.error));
    });

  return (
    <section className="mx-panel mx-s8" aria-labelledby="item-title">
      <div className="mx-panel-head">
        <h2 id="item-title">{t(kindTitles[detail.kind], { number: String(detail.number) })}</h2>
        <StatusChip row={detail} />
      </div>
      <div className="mx-panel-body">
        <div className="mx-inline" style={{ gap: 12 }}>
          <Avatar src={detail.subject?.avatar} name={detail.subject?.name ?? t('Gate')} size={40} />
          <div className="mx-stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
            <span className="mx-row-title">
              {detail.kind === 'gate'
                ? t('Members at the gate')
                : (detail.subject?.name ?? t('Unknown member'))}
            </span>
            <span className="mx-sub">{ago(t, detail.createdAt, now)}</span>
          </div>
          {detail.subject ? (
            <Link
              className="mx-btn mx-btn-ghost"
              href={`/g/${guildId}/members?member=${detail.subject.id}`}
            >
              {t('Member file')}
            </Link>
          ) : detail.kind === 'gate' ? (
            <Link className="mx-btn mx-btn-ghost" href={`/g/${guildId}/automod`}>
              {t('Open AutoMod')}
            </Link>
          ) : null}
        </div>

        {detail.held !== null ? (
          <p style={{ margin: 0 }}>
            {t.plural(
              detail.held,
              '{n} member waiting at the gate',
              '{n} members waiting at the gate',
            )}
          </p>
        ) : null}

        {detail.check ? (
          <div className="mx-stack" style={{ gap: 6 }}>
            {detail.check.state && checkStates[detail.check.state] ? (
              <p style={{ margin: 0 }}>{t(checkStates[detail.check.state] as Key)}</p>
            ) : null}
            <span className="mx-label">
              {t('Risk score {score}', { score: detail.check.score })}
            </span>
            {detail.check.reasons.length > 0 ? (
              <div className="mx-chips">
                {detail.check.reasons.map((reason) => (
                  <span key={reason.key} className="mx-chip">
                    {reasonText(t, reason)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {detail.excerpt ? (
          <div className="mx-stack" style={{ gap: 6 }}>
            <span className="mx-label">{t('Message')}</span>
            <blockquote
              className="mx-inset"
              style={{
                margin: 0,
                padding: '10px 12px',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {detail.excerpt}
            </blockquote>
            {detail.messageUrl ? (
              <a className="mx-sub" href={detail.messageUrl} target="_blank" rel="noreferrer">
                {t('Jump to message')}
              </a>
            ) : null}
          </div>
        ) : null}

        {detail.body ? (
          <div className="mx-stack" style={{ gap: 6 }}>
            <span className="mx-label">{t(bodyLabel)}</span>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {detail.body}
            </p>
          </div>
        ) : null}

        {detail.kind === 'report' && detail.reporters.length > 0 ? (
          <div className="mx-stack" style={{ gap: 6 }}>
            <span className="mx-label">{t('Reported by')}</span>
            <div className="mx-chips">
              {detail.reporters.map((person) => (
                <span key={person.id} className="mx-chip">
                  {person.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {!active ? (
          <div className="mx-stack" style={{ gap: 4 }}>
            <span className="mx-label">{t('Outcome')}</span>
            <span>
              {t(outcomeWords[detail.outcome ?? 'none'] ?? 'No action')}
              {detail.outcomeCase ? (
                <>
                  {', '}
                  <Link href={`/g/${guildId}/moderation?case=${detail.outcomeCase}`}>
                    {t('case #{number}', { number: String(detail.outcomeCase) })}
                  </Link>
                </>
              ) : null}
            </span>
            {detail.resolvedBy && detail.resolvedAt ? (
              <span className="mx-sub">
                {t('{name}, {when}', {
                  name: detail.resolvedBy.name,
                  when: ago(t, detail.resolvedAt, now),
                })}
              </span>
            ) : null}
            {detail.note ? <span style={{ color: 'var(--mx-text-2)' }}>{detail.note}</span> : null}
          </div>
        ) : null}
      </div>

      {active && !readOnly ? (
        <>
          <div className="mx-inline" style={{ padding: '0 16px 14px', flexWrap: 'wrap' }}>
            {choice ? null : <Choices detail={detail} onPick={setChoice} />}
            <span style={{ flex: 1 }} />
            {mine ? (
              <button
                type="button"
                className="mx-btn mx-btn-ghost"
                disabled={pending}
                onClick={() => claim(false)}
              >
                {t('Release')}
              </button>
            ) : (
              <button
                type="button"
                className="mx-btn mx-btn-ghost"
                disabled={pending}
                onClick={() => claim(true)}
              >
                {detail.status === 'claimed' ? t('Take over') : t('Claim')}
              </button>
            )}
            <StatusText status={status} />
          </div>
          {choice ? (
            <ResolveForm
              key={choice}
              detail={detail}
              choice={choice}
              onDone={(next) => {
                setStatus(next);
                setChoice(null);
              }}
              onCancel={() => setChoice(null)}
            />
          ) : null}
        </>
      ) : null}

      {detail.cases.length > 0 ? (
        <>
          <div className="mx-panel-head" style={{ paddingTop: 18 }}>
            <h3>{t('Earlier cases')}</h3>
          </div>
          {detail.cases.map((entry) => (
            <Link
              key={entry.number}
              className="mx-row mx-pick"
              href={`/g/${guildId}/moderation?case=${entry.number}`}
              style={entry.voided ? { opacity: 0.55 } : undefined}
            >
              <span className="mx-row-main">
                <span className="mx-row-title">
                  {t('Case #{number}', { number: String(entry.number) })}
                </span>
                <span className="mx-sub mx-ellipsis">
                  {[entry.action, entry.reason, ago(t, entry.createdAt, now)]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </span>
            </Link>
          ))}
        </>
      ) : null}
    </section>
  );
}

function SettingsPanel({ appealUrl }: { appealUrl: string }) {
  const t = useT();
  const { value, set } = useDraft<ModerationConfig>();
  return (
    <Panel title={t('Settings')} span={4}>
      <PanelBody>
        <Field label={t('Post new items in')}>
          <ChannelSelect
            value={value.inboxChannelId}
            none={null}
            onChange={(inboxChannelId) => set({ inboxChannelId })}
          />
        </Field>
      </PanelBody>
      <div className="mx-row">
        <div className="mx-row-main">
          <span className="mx-row-title">{t('Members can report')}</span>
          <span className="mx-sub mx-mono">m!report</span>
        </div>
        <Switch
          label={t('Members can report')}
          checked={value.reports}
          onChange={(reports) => set({ reports })}
        />
      </div>
      {value.reports ? (
        <PanelBody>
          <Field label={t('Report with a reaction')}>
            <EmojiPicker
              value={value.reportEmoji}
              label={t('Report with a reaction')}
              fallback="🚩"
              clearable
              onChange={(reportEmoji) => set({ reportEmoji })}
            />
          </Field>
        </PanelBody>
      ) : null}
      <div className="mx-row">
        <div className="mx-row-main">
          <span className="mx-row-title">{t('Ban appeals')}</span>
          {value.appeals ? (
            <span className="mx-sub mx-mono" style={{ overflowWrap: 'anywhere' }}>
              {appealUrl}
            </span>
          ) : null}
        </div>
        <Switch
          label={t('Ban appeals')}
          checked={value.appeals}
          onChange={(appeals) => set({ appeals })}
        />
      </div>
    </Panel>
  );
}

export function InboxView({
  mode,
  kind,
  list,
  counts,
  detail,
  self,
  appealUrl,
  now,
}: {
  mode: Mode;
  kind: InboxKind | null;
  list: InboxRow[];
  counts: { open: number; claimed: number; mine: number };
  detail: InboxDetail | null;
  self: string;
  appealUrl: string;
  now: string;
}) {
  const t = useT();
  const router = useRouter();
  const { go, pending } = useGo(mode, kind);
  useLive(['moderation'], () => router.refresh());

  const modeOptions: { value: Mode; label: string }[] = [
    { value: 'active', label: `${t('Open')} ${t.count(counts.open + counts.claimed)}` },
    { value: 'mine', label: `${t('Mine')} ${t.count(counts.mine)}` },
    { value: 'closed', label: t('Closed') },
  ];
  const emptyText =
    mode === 'closed'
      ? t('Nothing closed yet.')
      : mode === 'mine'
        ? t('Nothing claimed by you.')
        : t('Inbox is empty.');

  return (
    <Grid>
      <section className="mx-panel mx-s4" aria-labelledby="inbox-list">
        <div className="mx-panel-head">
          <h2 id="inbox-list">{t('Inbox')}</h2>
        </div>
        <div className="mx-inline" style={{ padding: '6px 16px 12px', flexWrap: 'wrap' }}>
          <Seg
            label={t('Show')}
            value={mode}
            options={modeOptions}
            onChange={(next) => go({ mode: next, item: null })}
            view
          />
          <Select
            label={t('Kind')}
            value={kind ?? 'all'}
            options={kindOptions.map((option) => ({ value: option.value, label: t(option.label) }))}
            onChange={(next) =>
              go({ kind: next === 'all' ? null : (next as InboxKind), item: null })
            }
          />
        </div>
        <div style={{ opacity: pending ? 0.6 : 1, borderTop: '1px solid var(--mx-line)' }}>
          {list.length === 0 ? (
            <Empty mood={mode === 'active' ? 'happy' : 'sleeping'}>{emptyText}</Empty>
          ) : (
            list.map((row) => (
              <ListRow
                key={row.number}
                row={row}
                selected={row.number === detail?.number}
                now={now}
                onPick={() => go({ item: row.number })}
              />
            ))
          )}
        </div>
      </section>
      {detail ? <DetailPanel key={detail.number} detail={detail} self={self} now={now} /> : null}
      <SettingsPanel appealUrl={appealUrl} />
    </Grid>
  );
}
