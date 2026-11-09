'use client';

import type { ModerationConfig } from '@maxwell/core/modules/moderation';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { fingerprint } from '@/components/live';
import { MessagePreview } from '@/components/message-preview';
import { useDraft } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import { CloseIcon } from '@/components/ui';
import { undoEntry } from '@/lib/actions';
import type { Key, Translator } from '@/lib/i18n';
import { dayTime, duration, until } from '@/lib/time';
import { addEvidence, removeEvidence, reviewCase, saveReason, voidCase } from './actions';
import type { CaseView } from './data';
import { ACTION_COLORS, ACTION_NAMES } from './labels';

const DAY = 86_400_000;

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const undoLabels: Record<string, Key> = {
  ban: 'Unban',
  timeout: 'Lift timeout',
  warn: 'Remove warn',
  flag: 'Dismiss',
  unban: 'Ban again',
  untimeout: 'Time out again',
};

function stateOf(
  t: Translator,
  view: CaseView,
  now: string,
  timezone: string,
  expiryDays: number | null,
): { label: string; color: string } {
  const color = ACTION_COLORS[view.action] ?? '#9A9EA6';
  const current = new Date(now).getTime();
  if (view.voidedAt) return { label: t('Void'), color: '#9A9EA6' };
  if (view.action === 'flag') {
    return view.endedAt
      ? { label: t('Reviewed'), color: '#9A9EA6' }
      : { label: t('Waiting for review'), color };
  }
  if (view.action === 'ban' || view.action === 'timeout') {
    if (view.endedAt) return { label: t('Ended'), color: '#9A9EA6' };
    if (view.expiresAt) {
      return new Date(view.expiresAt).getTime() > current
        ? {
            label: t('Active until {when}', { when: until(t, view.expiresAt, now, timezone) }),
            color,
          }
        : { label: t('Ended'), color: '#9A9EA6' };
    }
    return { label: t('Active'), color };
  }
  if (view.action === 'warn') {
    const created = new Date(view.createdAt).getTime();
    return expiryDays === null || created + expiryDays * DAY > current
      ? { label: t('Active'), color }
      : { label: t('Expired'), color: '#9A9EA6' };
  }
  return { label: t('Completed'), color: '#9A9EA6' };
}

function durationOf(t: Translator, view: CaseView, now: string, expiryDays: number | null): string {
  if (view.action === 'ban' || view.action === 'timeout') {
    if (view.durationSeconds) return duration(t, view.durationSeconds * 1_000);
    return view.action === 'ban' ? t('Permanent') : t('None');
  }
  if (view.action === 'warn') {
    if (expiryDays === null) return t('Never expires');
    const left = new Date(view.createdAt).getTime() + expiryDays * DAY - new Date(now).getTime();
    return left > 0
      ? t('{n, plural, one {Expires in # day} other {Expires in # days}}', {
          n: Math.ceil(left / DAY),
        })
      : t('Expired');
  }
  return t('None');
}

export function CaseDetail({ initial, now }: { initial: CaseView; now: string }) {
  const t = useT();
  const { guildId, timezone } = useGuild();
  const { value: config, readOnly } = useDraft<ModerationConfig>();
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [reason, setReason] = useState(initial.reason ?? '');
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState('');
  const [status, setStatus] = useState<Status>(null);
  const [refreshAt, setRefreshAt] = useState(0);
  const [pending, start] = useTransition();

  const seen = useRef(fingerprint(initial));
  const typed = useRef(false);
  typed.current = reason.trim() !== (view.reason ?? '');

  useEffect(() => {
    const next = fingerprint(initial);
    if (next === seen.current) return;
    seen.current = next;
    setView(initial);
    if (!typed.current) setReason(initial.reason ?? '');
  }, [initial]);

  useEffect(() => {
    if (!refreshAt) return;
    const timer = setTimeout(() => router.refresh(), 2500);
    return () => clearTimeout(timer);
  }, [refreshAt, router]);

  const state = stateOf(t, view, now, timezone, config.warnExpiryDays);
  const reasonChanged = reason.trim() !== (view.reason ?? '');
  const action = ACTION_NAMES[view.action];
  const title = action ? t(action) : view.action;
  const member = t.raw(view.member);
  const undoLabel = undoLabels[view.action];

  const apply = (
    run: () => Promise<{ ok: true; data?: CaseView } | { ok: false; error: string }>,
  ) =>
    start(async () => {
      const result = await run();
      if (!result.ok) {
        setStatus({ message: result.error, error: true });
        return;
      }
      if (result.data) {
        setView(result.data);
        setReason(result.data.reason ?? '');
      }
      setStatus({ message: 'Sorted.', error: false });
    });

  const queued = (run: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const result = await run();
      if (!result.ok) {
        setStatus({ message: result.error ?? 'That did not work.', error: true });
        return;
      }
      setStatus({ message: 'Maxwell is on it.', error: false });
      setRefreshAt(Date.now());
    });

  return (
    <section className="mx-panel mx-s4" aria-labelledby="case-detail">
      <div className="mx-panel-head">
        <h2 id="case-detail">
          {t('Case {number}: {action}', { number: String(view.number), action: title })}
        </h2>
        <span className="mx-chip" style={{ color: state.color }}>
          {state.label}
        </span>
      </div>
      <div className="mx-panel-body">
        <div className="mx-fields" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <div className="mx-field">
            <span className="mx-label">{t('Member')}</span>
            {view.userId ? (
              <Link href={`/g/${guildId}/members?member=${view.userId}`}>{member}</Link>
            ) : (
              <span>{member}</span>
            )}
          </div>
          <div className="mx-field">
            <span className="mx-label">{t('Moderator')}</span>
            <span>{t.raw(view.moderator)}</span>
          </div>
          <div className="mx-field">
            <span className="mx-label">{t('Duration')}</span>
            <span>{durationOf(t, view, now, config.warnExpiryDays)}</span>
          </div>
          <div className="mx-field">
            <span className="mx-label">{t('When')}</span>
            <span>{dayTime(t, view.createdAt, now, timezone)}</span>
          </div>
        </div>

        <label className="mx-field">
          <span className="mx-label">{t('Reason')}</span>
          <textarea
            className="mx-textarea"
            rows={2}
            maxLength={1_500}
            value={reason}
            readOnly={readOnly}
            placeholder={readOnly ? undefined : t('No reason yet')}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {reasonChanged && !readOnly ? (
          <div className="mx-inline">
            <button
              type="button"
              className="mx-btn"
              disabled={pending}
              onClick={() => apply(() => saveReason(guildId, view.number, reason))}
            >
              {t('Save reason')}
            </button>
            <button
              type="button"
              className="mx-btn mx-btn-ghost"
              disabled={pending}
              onClick={() => setReason(view.reason ?? '')}
            >
              {t('Cancel')}
            </button>
          </div>
        ) : null}

        <div className="mx-field">
          <span className="mx-label">{t('Evidence')}</span>
          {view.evidence.length === 0 && (readOnly || !adding) ? (
            <span className="mx-sub">{t('No links')}</span>
          ) : null}
          {view.evidence.map((url) => (
            <div key={url} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <a
                className="mx-mono"
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                style={{
                  color: '#3A9EEA',
                  textDecoration: 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                  flex: 1,
                }}
              >
                {url.replace(/^https?:\/\//, '')}
              </a>
              {readOnly ? null : (
                <button
                  type="button"
                  className="mx-chip-x"
                  aria-label={t('Remove {name}', { name: url })}
                  disabled={pending}
                  onClick={() => apply(() => removeEvidence(guildId, view.number, url))}
                >
                  <CloseIcon />
                </button>
              )}
            </div>
          ))}
          {readOnly ? null : adding ? (
            <form
              style={{ display: 'flex', gap: 6 }}
              onSubmit={(event) => {
                event.preventDefault();
                if (!link.trim()) return;
                start(async () => {
                  const result = await addEvidence(guildId, view.number, link);
                  if (!result.ok) {
                    setStatus({ message: result.error, error: true });
                    return;
                  }
                  if (result.data) setView(result.data);
                  setLink('');
                  setAdding(false);
                  setStatus(null);
                });
              }}
            >
              <input
                className="mx-input mx-mono"
                type="url"
                aria-label={t('Evidence link')}
                placeholder="https://"
                value={link}
                maxLength={500}
                onChange={(event) => setLink(event.target.value)}
              />
              <button type="submit" className="mx-btn" disabled={pending || !link.trim()}>
                {t('Add')}
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="mx-listbox-button mx-listbox-compact"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setAdding(true)}
            >
              <span className="mx-add-trigger">
                <PlusIcon />
                {t('Add link')}
              </span>
            </button>
          )}
        </div>

        {view.excerpt ? (
          <div className="mx-field">
            <span className="mx-label">{t('Message that led to it')}</span>
            <div className="mx-preview">
              <MessagePreview
                name={member}
                avatar={view.memberAvatar}
                bot={false}
                avatarSize={28}
                time={dayTime(t, view.createdAt, now, timezone)}
                content={view.excerpt}
              />
            </div>
          </div>
        ) : null}

        {view.voidedAt && view.voidReason ? (
          <span className="mx-sub">{view.voidReason}</span>
        ) : null}

        <div className="mx-inline">
          {!readOnly && view.action === 'flag' && !view.endedAt && !view.voidedAt ? (
            <>
              <button
                type="button"
                className="mx-btn mx-btn-primary"
                disabled={pending}
                onClick={() => queued(() => reviewCase(guildId, view.number, true))}
              >
                {t('Approve')}
              </button>
              <button
                type="button"
                className="mx-btn"
                disabled={pending}
                onClick={() => queued(() => reviewCase(guildId, view.number, false))}
              >
                {t('Decline')}
              </button>
            </>
          ) : null}
          {!readOnly && view.undo === 'available' && view.auditId && view.action !== 'flag' ? (
            <button
              type="button"
              className="mx-btn"
              disabled={pending}
              onClick={() => {
                const entry = view.auditId;
                if (entry) queued(() => undoEntry(guildId, entry));
              }}
            >
              {undoLabel ? t(undoLabel) : t('Undo')}
            </button>
          ) : null}
          {!readOnly && !view.voidedAt ? (
            <TwoStep
              label={t('Void case')}
              disabled={pending}
              run={() => apply(() => voidCase(guildId, view.number))}
            />
          ) : null}
          {view.userId ? (
            <Link
              className="mx-btn mx-btn-ghost"
              href={`/g/${guildId}/members?member=${view.userId}`}
            >
              {t('Member file')}
            </Link>
          ) : null}
          <StatusText status={status} />
        </div>
      </div>
    </section>
  );
}
