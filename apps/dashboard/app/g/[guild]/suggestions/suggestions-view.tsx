'use client';

import type { SuggestionStatus, SuggestionsConfig } from '@maxwell/core/modules/suggestions';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { ChannelSelect, Seg, Switch, TextInput } from '@/components/controls';
import { EmojiPicker } from '@/components/emoji-picker';
import { useChannelName, useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { EmbedPreview, Markdown, MessagePreview } from '@/components/message-preview';
import { useDraft } from '@/components/module-shell';
import { failed, StatusText } from '@/components/status-text';
import { Empty, Field, Grid, Panel, PanelBody } from '@/components/ui';
import type { Key } from '@/lib/i18n';
import { ago, inSentence } from '@/lib/time';
import { loadMore, setStatus } from './actions';
import type { Item, Sort } from './load';

const statuses: { value: SuggestionStatus; label: Key; mark: Key; color: string }[] = [
  { value: 'open', label: 'Open', mark: 'Mark open', color: '#C9CCD2' },
  { value: 'planned', label: 'Planned', mark: 'Mark planned', color: '#3A9EEA' },
  { value: 'done', label: 'Done', mark: 'Mark done', color: '#2EB67D' },
  { value: 'declined', label: 'Declined', mark: 'Mark declined', color: '#EC5B78' },
];

const embedColors: Record<SuggestionStatus, string> = {
  open: '#F26B3A',
  planned: '#3A9EEA',
  done: '#2EB67D',
  declined: '#9A9EA6',
};

const orders: { value: Sort; label: Key }[] = [
  { value: 'top', label: 'Top' },
  { value: 'new', label: 'Newest' },
];

function scoreText(score: number): string {
  return score > 0 ? `+${score}` : String(score);
}

function SuggestionRow({ item, now }: { item: Item; now: number }) {
  const t = useT();
  const { guildId } = useGuild();
  const { readOnly } = useDraft<SuggestionsConfig>();
  const [current, setCurrent] = useState(item);
  const [picked, setPicked] = useState<SuggestionStatus | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const score = current.up - current.down;
  const chosen = statuses.find((entry) => entry.value === picked);

  const save = () =>
    start(async () => {
      if (!picked) return;
      const result = await setStatus(guildId, {
        suggestionId: current.id,
        status: picked,
        reason,
      });
      if (result.ok) {
        setCurrent({ ...current, status: picked, reason: reason.trim() || null, statusBy: null });
        setPicked(null);
        setError(null);
      } else {
        setError(result.error);
      }
    });

  return (
    <div className="mx-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div
        style={{
          width: 54,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          paddingTop: 2,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--mx-display)',
            fontWeight: 700,
            fontSize: 18,
            color: score > 0 ? '#2EB67D' : score < 0 ? '#EC5B78' : '#C9CCD2',
          }}
        >
          {scoreText(score)}
        </span>
        <span className="mx-sub" style={{ fontSize: 11 }}>
          <span className="mx-up">{current.up}</span> /{' '}
          <span className="mx-down">{current.down}</span>
        </span>
      </div>
      <div className="mx-row-main" style={{ gap: 4, minWidth: 200 }}>
        <span className="mx-row-title" style={{ overflowWrap: 'anywhere' }}>
          <Markdown text={current.content} as="span" />
        </span>
        <span className="mx-sub">
          {t('#{number} by {name}, {when}', {
            number: String(current.number),
            name: current.author ?? t('a former member'),
            when: inSentence(t, ago(t, current.createdAt, now)),
          })}
        </span>
        {current.reason && current.status !== 'open' ? (
          <span style={{ fontSize: 13, color: 'var(--mx-text-2)' }}>
            {current.statusBy ? `${current.reason}, ${current.statusBy}` : current.reason}
          </span>
        ) : null}
        {chosen ? (
          <div className="mx-inline" style={{ paddingTop: 4 }}>
            <div style={{ flex: '1 1 220px' }}>
              <TextInput
                value={reason}
                maxLength={1000}
                label={t('Reason for {status}', { status: t(chosen.label) })}
                placeholder={t('Reason, optional')}
                onChange={setReason}
              />
            </div>
            <button
              type="button"
              className="mx-btn mx-btn-primary"
              disabled={pending}
              onClick={save}
            >
              {t(chosen.mark)}
            </button>
            <button
              type="button"
              className="mx-btn mx-btn-ghost"
              disabled={pending}
              onClick={() => {
                setPicked(null);
                setError(null);
              }}
            >
              {t('Cancel')}
            </button>
            <StatusText status={error ? failed(error) : null} />
          </div>
        ) : null}
      </div>
      <div
        className="mx-seg"
        role="group"
        aria-label={t('Status of suggestion {number}', { number: String(current.number) })}
      >
        {statuses.map((entry) => {
          const active = (picked ?? current.status) === entry.value;
          return (
            <button
              key={entry.value}
              type="button"
              aria-pressed={active}
              disabled={readOnly || pending}
              style={active ? { color: entry.color } : undefined}
              onClick={() => {
                if (entry.value === current.status && !picked) return;
                if (entry.value === current.status) {
                  setPicked(null);
                  return;
                }
                setPicked(entry.value);
                setReason(entry.value === 'open' ? '' : (current.reason ?? ''));
                setError(null);
              }}
            >
              {t(entry.label)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Board({
  status,
  sort,
  initial,
  more,
  counts,
  now,
}: {
  status: SuggestionStatus | null;
  sort: Sort;
  initial: Item[];
  more: boolean;
  counts: Record<SuggestionStatus, number>;
  now: number;
}) {
  const t = useT();
  const { guildId } = useGuild();
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState(initial);
  const [hasMore, setHasMore] = useState(more);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const first = useRef({ items: initial, view: `${status}:${sort}` });

  useEffect(() => {
    const view = `${status}:${sort}`;
    if (first.current.items === initial) return;
    const previousFirst = first.current;
    first.current = { items: initial, view };
    if (previousFirst.view !== view) {
      setItems(initial);
      setHasMore(more);
      return;
    }
    const known = new Set(initial.map((item) => item.id));
    setItems((previous) => [
      ...initial,
      ...previous.slice(previousFirst.items.length).filter((item) => !known.has(item.id)),
    ]);
  }, [initial, more, status, sort]);

  const go = (next: { status?: SuggestionStatus | null; sort?: Sort }) => {
    const params = new URLSearchParams();
    const nextStatus = next.status === undefined ? status : next.status;
    const nextSort = next.sort ?? sort;
    if (nextStatus) params.set('status', nextStatus);
    if (nextSort === 'new') params.set('sort', 'new');
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const fetchMore = () =>
    start(async () => {
      const result = await loadMore(guildId, {
        status: status ?? undefined,
        sort,
        offset: items.length,
        before: sort === 'new' ? items.at(-1)?.id : undefined,
      });
      if (!result.ok || !result.data) {
        setError(result.ok ? 'That did not work.' : result.error);
        return;
      }
      const seen = new Set(items.map((item) => item.id));
      setItems([...items, ...result.data.items.filter((item) => !seen.has(item.id))]);
      setHasMore(result.data.more);
    });

  return (
    <Panel
      title={t('Board')}
      span={8}
      actions={
        total === 0 && !status ? null : (
          <>
            <Seg
              label={t('Order')}
              value={sort}
              options={orders.map((option) => ({ ...option, label: t(option.label) }))}
              onChange={(next) => go({ sort: next })}
              view
            />
            <Seg
              label={t('Status filter')}
              value={status ?? 'all'}
              options={[
                { value: 'all', label: `${t('All')} ${t.count(total)}` },
                ...statuses.map((entry) => ({
                  value: entry.value,
                  label: `${t(entry.label)} ${t.count(counts[entry.value])}`,
                })),
              ]}
              onChange={(next) => go({ status: next === 'all' ? null : next })}
              view
            />
          </>
        )
      }
    >
      {items.length === 0 ? (
        status ? (
          <Empty>{t('Nothing with this status.')}</Empty>
        ) : (
          <Empty mood="sleeping">{t('No suggestions yet.')}</Empty>
        )
      ) : null}
      {items.map((item) => (
        <SuggestionRow key={item.id} item={item} now={now} />
      ))}
      {hasMore || error ? (
        <div className="mx-row" style={{ justifyContent: 'center' }}>
          <StatusText status={error ? failed(error) : null} />
          {hasMore ? (
            <button type="button" className="mx-btn" disabled={pending} onClick={fetchMore}>
              {t('Show more')}
            </button>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function SettingsPanel() {
  const t = useT();
  const { value, set } = useDraft<SuggestionsConfig>();
  const toggles: { key: 'thread' | 'notifyAuthor' | 'cleanup'; title: string }[] = [
    { key: 'thread', title: t('Thread for each suggestion') },
    { key: 'notifyAuthor', title: t('Message the author on status changes') },
    { key: 'cleanup', title: t('Delete the command message') },
  ];
  return (
    <Panel title={t('Settings')}>
      <PanelBody>
        <Field label={t('Channel')}>
          <ChannelSelect
            value={value.channelId}
            none={null}
            onChange={(channelId) => set({ channelId })}
          />
        </Field>
        <div className="mx-fields" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <Field label={t('Vote up with')}>
            <EmojiPicker
              value={value.upEmoji}
              label={t('Vote up with')}
              fallback="👍"
              clearable
              onChange={(upEmoji) => set({ upEmoji })}
            />
          </Field>
          <Field label={t('Vote down with')}>
            <EmojiPicker
              value={value.downEmoji}
              label={t('Vote down with')}
              fallback="👎"
              clearable
              onChange={(downEmoji) => set({ downEmoji })}
            />
          </Field>
        </div>
      </PanelBody>
      {toggles.map((toggle) => (
        <div className="mx-row" key={toggle.key}>
          <div className="mx-row-main">
            <span className="mx-row-title">{toggle.title}</span>
          </div>
          <Switch
            label={toggle.title}
            checked={value[toggle.key]}
            onChange={(next) => set({ [toggle.key]: next })}
          />
        </div>
      ))}
    </Panel>
  );
}

function PreviewPanel({ preview }: { preview: Item }) {
  const t = useT();
  const { value } = useDraft<SuggestionsConfig>();
  const channelName = useChannelName();
  return (
    <Panel
      title={
        value.channelId
          ? t('In {channel}', { channel: channelName(value.channelId) })
          : t('Preview')
      }
    >
      <PreviewBody preview={preview} />
    </Panel>
  );
}

function PreviewBody({ preview }: { preview: Item }) {
  const t = useT();
  const status = preview.status;
  const entry = statuses.find((candidate) => candidate.value === status);
  const label = entry ? t(entry.label) : t('Open');
  const color = embedColors[status];
  return (
    <PanelBody>
      <div className="mx-preview">
        <MessagePreview avatarSize={30}>
          <EmbedPreview
            color={color}
            author={preview.author}
            title={t('Suggestion {number}', { number: String(preview.number) })}
            description={preview.content}
          >
            <span>
              {t('Status:')} <strong style={{ color }}>{label}</strong>
            </span>
            {preview.reason && status !== 'open' ? (
              <span className="mx-sub">{t('Reason: {reason}', { reason: preview.reason })}</span>
            ) : null}
            {status !== 'open' ? (
              <span className="mx-sub">
                {t('Votes: {up} for, {down} against', { up: preview.up, down: preview.down })}
              </span>
            ) : null}
          </EmbedPreview>
          <div style={{ display: 'flex', gap: 6 }}>
            <span className="mx-chip">{t('Up {count}', { count: preview.up })}</span>
            <span className="mx-chip">{t('Down {count}', { count: preview.down })}</span>
          </div>
        </MessagePreview>
      </div>
    </PanelBody>
  );
}

export function SuggestionsView({
  status,
  sort,
  initial,
  more,
  counts,
  preview,
  now,
}: {
  status: SuggestionStatus | null;
  sort: Sort;
  initial: Item[];
  more: boolean;
  counts: Record<SuggestionStatus, number>;
  preview: Item | null;
  now: number;
}) {
  return (
    <Grid>
      <Board status={status} sort={sort} initial={initial} more={more} counts={counts} now={now} />
      <div className="mx-s4" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SettingsPanel />
        {preview ? <PreviewPanel preview={preview} /> : null}
      </div>
    </Grid>
  );
}
