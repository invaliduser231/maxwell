'use client';

import type { MemberView } from '@maxwell/core/stores/moderation';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Checkbox, Seg, Select } from '@/components/controls';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { Markdown } from '@/components/message-preview';
import { failed, type Status, StatusText } from '@/components/status-text';
import { Avatar, Callout, Empty, Grid, type Mood } from '@/components/ui';
import type { Key } from '@/lib/i18n';
import { age, date, dayTime, duration, since } from '@/lib/time';
import { addNote, memberAction, removeNote } from './actions';
import type { ListedMember, MemberFile, TimelineItem, TimelineKind } from './data';

type Kind = 'all' | 'cases' | 'automod' | 'notes' | 'joins';
type QuickAction = 'warn' | 'timeout' | 'kick' | 'ban' | 'unban' | 'untimeout';

const viewOptions: { value: MemberView; label: Key }[] = [
  { value: 'flagged', label: 'Flagged' },
  { value: 'new', label: 'New' },
  { value: 'all', label: 'All' },
];

const kindOptions: { value: Kind; label: Key; kinds: TimelineKind[] }[] = [
  { value: 'all', label: 'All', kinds: [] },
  { value: 'cases', label: 'Cases', kinds: ['case'] },
  { value: 'automod', label: 'AutoMod', kinds: ['automod'] },
  { value: 'notes', label: 'Notes', kinds: ['note'] },
  { value: 'joins', label: 'Joins', kinds: ['join', 'leave'] },
];

const actionWords: Record<QuickAction, Key> = {
  warn: 'Warn',
  timeout: 'Time out',
  kick: 'Kick',
  ban: 'Ban',
  unban: 'Unban',
  untimeout: 'Lift timeout',
};

const timeoutChoices = [10, 60, 360, 1_440, 10_080, 40_320];
const banChoices = [0, 1_440, 10_080, 43_200];

function ListRow({
  member,
  selected,
  now,
  onPick,
}: {
  member: ListedMember;
  selected: boolean;
  now: string;
  onPick: () => void;
}) {
  const t = useT();
  const current = new Date(now).getTime();
  const sub = member.leftAt
    ? t('Left {when}', { when: since(t, current - new Date(member.leftAt).getTime()) })
    : member.joinedAt
      ? t('Joined {when}', { when: since(t, current - new Date(member.joinedAt).getTime()) })
      : t('Seen {when}', { when: since(t, current - new Date(member.lastAt).getTime()) });
  return (
    <button
      type="button"
      className="mx-row mx-row-button"
      onClick={onPick}
      aria-current={selected ? 'true' : undefined}
    >
      <Avatar src={member.avatar} name={member.name} size={30} />
      <span className="mx-row-main">
        <span className="mx-row-title mx-ellipsis">{member.name}</span>
        <span className="mx-sub">{sub}</span>
      </span>
      {member.flag ? (
        <span className="mx-chip" style={{ color: member.flag.color }}>
          {member.flag.text}
        </span>
      ) : null}
    </button>
  );
}

function ActionForm({
  action,
  file,
  requireReason,
  defaultTimeoutMinutes,
  shield,
  onDone,
  onCancel,
}: {
  action: QuickAction;
  file: MemberFile;
  requireReason: boolean;
  defaultTimeoutMinutes: number;
  shield: boolean;
  onDone: (status: Status) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { guildId } = useGuild();
  const [reason, setReason] = useState('');
  const timeouts = timeoutChoices.includes(defaultTimeoutMinutes)
    ? timeoutChoices
    : [...timeoutChoices, defaultTimeoutMinutes].sort((a, b) => a - b);
  const [minutes, setMinutes] = useState(action === 'timeout' ? defaultTimeoutMinutes : 0);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState(false);
  const [tried, setTried] = useState(false);
  const [pending, start] = useTransition();
  const needsReason =
    requireReason && action !== 'unban' && action !== 'untimeout' && !reason.trim();
  const timed = action === 'timeout' || action === 'ban';
  const choices = action === 'timeout' ? timeouts : banChoices;
  const danger = action === 'ban' || action === 'kick';

  return (
    <form
      className="mx-inset mx-stack"
      style={{ margin: '0 16px 14px', padding: 14 }}
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (needsReason) return;
        start(async () => {
          const result = await memberAction(guildId, {
            action,
            userId: file.userId,
            reason,
            durationSeconds: timed && minutes > 0 ? minutes * 60 : null,
            shield: action === 'ban' && share,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          onDone({ message: 'Maxwell is on it.', error: false });
        });
      }}
    >
      <div className="mx-fields">
        <label className="mx-field" style={timed ? undefined : { gridColumn: '1 / -1' }}>
          <span className="mx-label">{t('Reason')}</span>
          <input
            className="mx-input"
            value={reason}
            maxLength={1_500}
            placeholder={requireReason ? undefined : t('Optional')}
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
              options={choices.map((value) => ({
                value: String(value),
                label: value === 0 ? t('Permanent') : duration(t, value * 60_000),
              }))}
              onChange={(next) => setMinutes(Number(next))}
            />
          </div>
        ) : null}
      </div>
      {shield && action === 'ban' ? (
        <Checkbox checked={share} onChange={setShare} label={t('Share with Maxwell Shield')} />
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
          {`${t(actionWords[action])} ${file.name}`}
        </button>
      </div>
    </form>
  );
}

function Timeline({
  items,
  now,
  readOnly,
  onRemoveNote,
  removing,
}: {
  items: TimelineItem[];
  now: string;
  readOnly: boolean;
  onRemoveNote: (id: string) => void;
  removing: boolean;
}) {
  const t = useT();
  const { timezone } = useGuild();
  if (items.length === 0) return <Empty>{t('Nothing here yet.')}</Empty>;
  return (
    <div style={{ padding: '8px 16px 4px' }}>
      {items.map((item) => (
        <div key={item.id} style={{ display: 'flex', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              width: 12,
              flexShrink: 0,
            }}
          >
            <span
              className="mx-dot"
              style={{ background: item.color, width: 10, height: 10, marginTop: 5 }}
            />
            <span
              style={{ flex: 1, width: 2, background: 'var(--mx-line-strong)', minHeight: 12 }}
            />
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              paddingBottom: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span className="mx-row-title">{item.title}</span>
              <span className="mx-sub" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {dayTime(t, item.at, now, timezone)}
                {item.noteId && !readOnly ? (
                  <button
                    type="button"
                    className="mx-btn mx-btn-ghost"
                    style={{ minHeight: 24, padding: '2px 6px' }}
                    aria-label={t('Remove note from {when}', {
                      when: dayTime(t, item.at, now, timezone),
                    })}
                    disabled={removing}
                    onClick={() => {
                      const id = item.noteId;
                      if (id) onRemoveNote(id);
                    }}
                  >
                    {t('Remove')}
                  </button>
                ) : null}
              </span>
            </div>
            <span
              className="mx-sub"
              style={{
                color: 'var(--mx-text-2)',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {item.detail}
            </span>
            {item.quote ? (
              <span
                className="mx-inset"
                style={{
                  marginTop: 4,
                  padding: '7px 10px',
                  color: 'var(--mx-text-2)',
                }}
              >
                <Markdown text={item.quote} as="span" />
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function FilePanel({
  file,
  now,
  readOnly,
  self,
  requireReason,
  defaultTimeoutMinutes,
  shield,
}: {
  file: MemberFile;
  now: string;
  readOnly: boolean;
  self: string;
  requireReason: boolean;
  defaultTimeoutMinutes: number;
  shield: boolean;
}) {
  const t = useT();
  const { guildId, timezone } = useGuild();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>('all');
  const [action, setAction] = useState<QuickAction | null>(null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<Status>(null);
  const [refreshAt, setRefreshAt] = useState(0);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!refreshAt) return;
    const timer = setTimeout(() => router.refresh(), 2500);
    return () => clearTimeout(timer);
  }, [refreshAt, router]);

  const current = new Date(now).getTime();
  const chips: string[] = [];
  if (file.accountCreated) {
    chips.push(
      t('Account {age} old', { age: age(t, current - new Date(file.accountCreated).getTime()) }),
    );
  }
  if (file.leftAt) chips.push(t('Left on {date}', { date: date(t, file.leftAt, timezone) }));
  else if (file.joinedAt) {
    chips.push(t('Joined on {date}', { date: date(t, file.joinedAt, timezone) }));
  } else if (!file.inServer) chips.push(t('Not in the server'));
  if (file.invite) chips.push(file.invite);
  if (file.level !== null) chips.push(t('Level {level}', { level: file.level }));
  if (file.balance) chips.push(file.balance);
  if (file.banned) chips.push(t('Banned'));
  else if (file.timedOut) chips.push(t('Timed out'));

  const stats = [
    { label: t('Cases'), value: t.count(file.stats.cases) },
    { label: t('Active warns'), value: t.count(file.stats.activeWarns) },
    { label: t('AutoMod hits'), value: t.count(file.stats.automod) },
    { label: t('Notes'), value: t.count(file.stats.notes) },
    { label: t('Invited'), value: file.stats.invited },
  ];
  const quiet =
    file.stats.cases + file.stats.activeWarns + file.stats.automod + file.stats.notes === 0 &&
    file.stats.invited === '0';

  const filter = kindOptions.find((option) => option.value === kind);
  const items =
    !filter || filter.kinds.length === 0
      ? file.timeline
      : file.timeline.filter((item) => filter.kinds.includes(item.kind));

  const quick: QuickAction[] = file.userId === self ? [] : ['warn', 'timeout', 'kick', 'ban'];
  if (file.timedOut) quick.splice(quick.indexOf('timeout'), 1, 'untimeout');
  if (file.banned) quick.splice(quick.indexOf('ban'), 1, 'unban');

  return (
    <section className="mx-panel mx-s8" aria-labelledby="file-title">
      <div
        className="mx-panel-body"
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 14,
          paddingTop: 16,
        }}
      >
        <Avatar src={file.avatar} name={file.name} size={56} />
        <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 id="file-title" style={{ margin: 0, fontFamily: 'var(--mx-display)', fontSize: 20 }}>
            {file.name}{' '}
            {file.handle ? (
              <span className="mx-sub" style={{ fontFamily: 'var(--mx-body)', fontWeight: 400 }}>
                @{file.handle}
              </span>
            ) : null}
          </h2>
          <div className="mx-chips">
            {chips.map((chip) => (
              <span key={chip} className="mx-chip">
                {chip}
              </span>
            ))}
          </div>
        </div>
        {readOnly || quick.length === 0 ? null : (
          <div className="mx-inline" style={{ gap: 6 }}>
            {quick.map((entry) => (
              <button
                key={entry}
                type="button"
                className={entry === 'ban' ? 'mx-btn mx-btn-danger' : 'mx-btn'}
                aria-pressed={action === entry}
                onClick={() => {
                  setStatus(null);
                  setAction(action === entry ? null : entry);
                }}
              >
                {t(actionWords[entry])}
              </button>
            ))}
          </div>
        )}
      </div>

      {action && !readOnly ? (
        <ActionForm
          key={action}
          action={action}
          file={file}
          requireReason={requireReason}
          defaultTimeoutMinutes={defaultTimeoutMinutes}
          shield={shield}
          onCancel={() => setAction(null)}
          onDone={(next) => {
            setAction(null);
            setStatus(next);
            setRefreshAt(Date.now());
          }}
        />
      ) : null}

      {file.risk.length > 0 || status ? (
        <div className="mx-panel-body" style={{ paddingTop: 0 }}>
          {file.risk.length > 0 ? <Callout tone="warn">{file.risk.join(' ')}</Callout> : null}
          <StatusText status={status} />
        </div>
      ) : null}

      <div
        className={quiet ? 'mx-inset mx-stat-quiet' : 'mx-inset'}
        style={{
          margin: '0 16px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        }}
      >
        {stats.map((stat) => (
          <div key={stat.label} className="mx-stat">
            <span className="mx-stat-label">{stat.label}</span>
            <span className="mx-stat-value" style={{ fontSize: 18 }}>
              {stat.value}
            </span>
          </div>
        ))}
      </div>

      <div className="mx-panel-head" style={{ paddingTop: 18 }}>
        <h3>{t('Timeline')}</h3>
        <Seg
          label={t('Filter timeline')}
          value={kind}
          options={kindOptions.map((option) => ({ ...option, label: t(option.label) }))}
          onChange={setKind}
          view
        />
      </div>
      <Timeline
        items={items}
        now={now}
        readOnly={readOnly}
        removing={pending}
        onRemoveNote={(id) =>
          start(async () => {
            const result = await removeNote(guildId, id);
            setStatus(result.ok ? null : { message: result.error, error: true });
          })
        }
      />

      {readOnly ? null : (
        <form
          className="mx-panel-body"
          style={{ borderTop: '1px solid var(--mx-line)', paddingTop: 14 }}
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) return;
            start(async () => {
              const result = await addNote(guildId, file.userId, draft);
              if (!result.ok) {
                setStatus({ message: result.error, error: true });
                return;
              }
              setDraft('');
              setStatus(null);
            });
          }}
        >
          <label className="mx-field">
            <span className="mx-label">{t('Note')}</span>
            <textarea
              className="mx-textarea"
              rows={2}
              placeholder={t('Only moderators see this')}
              maxLength={1_000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              className="mx-btn mx-btn-primary"
              disabled={pending || !draft.trim()}
            >
              {t('Save note')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export function MembersView({
  view,
  q,
  list,
  selectedId,
  file,
  memberCount,
  readOnly,
  self,
  requireReason,
  defaultTimeoutMinutes,
  shield,
  now,
}: {
  view: MemberView;
  q: string;
  list: ListedMember[];
  selectedId: string | null;
  file: MemberFile | null;
  memberCount: number | null;
  readOnly: boolean;
  self: string;
  requireReason: boolean;
  defaultTimeoutMinutes: number;
  shield: boolean;
  now: string;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(q);
  const [pending, start] = useTransition();

  const go = (next: { view?: MemberView; q?: string; member?: string | null }) => {
    const params = new URLSearchParams();
    const nextView = next.view ?? view;
    const nextQ = next.q ?? q;
    if (nextView !== 'flagged') params.set('view', nextView);
    if (nextQ) params.set('q', nextQ);
    if (next.member) params.set('member', next.member);
    const text = params.toString();
    start(() => router.push(text ? `${pathname}?${text}` : pathname, { scroll: false }));
  };

  const alone = !file && !selectedId;
  const emptyMood: Mood = q ? 'thinking' : view === 'flagged' ? 'happy' : 'sleeping';
  const emptyText = q
    ? t('Nobody matches.')
    : view === 'flagged'
      ? t('Nobody flagged.')
      : view === 'new'
        ? t('No new members.')
        : t('Nobody here yet.');
  const emptyAction = q ? (
    <button
      type="button"
      className="mx-btn"
      onClick={() => {
        setSearch('');
        go({ q: '', member: null });
      }}
    >
      {t('Clear search')}
    </button>
  ) : view !== 'all' ? (
    <button type="button" className="mx-btn" onClick={() => go({ view: 'all', member: null })}>
      {t('Show everyone')}
    </button>
  ) : null;

  return (
    <Grid>
      <section className={`mx-panel mx-s${alone ? 12 : 4}`} aria-labelledby="list-title">
        <div className="mx-panel-head">
          <h2 id="list-title">{t('Members')}</h2>
          {memberCount !== null ? <span className="mx-sub">{t.count(memberCount)}</span> : null}
        </div>
        <div className="mx-inline" style={{ padding: '6px 16px 12px' }}>
          <form
            role="search"
            style={{ flex: '1 1 200px', maxWidth: alone ? 360 : undefined }}
            onSubmit={(event) => {
              event.preventDefault();
              go({ q: search.trim(), member: null });
            }}
          >
            <input
              className="mx-input"
              type="search"
              aria-label={t('Search members')}
              placeholder={t('Name, ID or invite code')}
              value={search}
              maxLength={64}
              onChange={(event) => {
                setSearch(event.target.value);
                if (!event.target.value && q) go({ q: '', member: null });
              }}
            />
          </form>
          {q ? null : (
            <Seg
              label={t('Show')}
              value={view}
              options={viewOptions.map((option) => ({ ...option, label: t(option.label) }))}
              onChange={(next) => go({ view: next, member: null })}
              view
            />
          )}
        </div>
        <div style={{ opacity: pending ? 0.6 : 1, borderTop: '1px solid var(--mx-line)' }}>
          {list.length === 0 ? (
            <Empty mood={emptyMood}>
              <div className="mx-stack" style={{ alignItems: 'center' }}>
                <span>{emptyText}</span>
                {emptyAction}
              </div>
            </Empty>
          ) : (
            list.map((member) => (
              <ListRow
                key={member.userId}
                member={member}
                selected={member.userId === selectedId}
                now={now}
                onPick={() => go({ member: member.userId })}
              />
            ))
          )}
        </div>
      </section>

      {file ? (
        <FilePanel
          key={file.userId}
          file={file}
          now={now}
          readOnly={readOnly}
          self={self}
          requireReason={requireReason}
          defaultTimeoutMinutes={defaultTimeoutMinutes}
          shield={shield}
        />
      ) : alone ? null : (
        <section className="mx-panel mx-s8" aria-label={t('Member file')}>
          <Empty mood="skeptical">{t('Maxwell knows nothing about this ID.')}</Empty>
        </section>
      )}
    </Grid>
  );
}
