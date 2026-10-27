'use client';

import {
  FEED_LIMIT,
  type FeedSource,
  type FeedsConfig,
  type FeedType,
  feedSourceHints,
  feedSourceValid,
  feedTemplateVariables,
  feedTypes,
} from '@maxwell/core/modules/feeds';
import { useRouter } from 'next/navigation';
import { type CSSProperties, type ReactNode, useState, useTransition } from 'react';
import {
  ChannelSelect,
  RoleSelect,
  Select,
  Switch,
  TextArea,
  TextInput,
  ToggleRow,
  WordList,
} from '@/components/controls';
import { ChannelType, useChannelName, useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { EmbedPreview, MessagePreview } from '@/components/message-preview';
import { useDraft, useReadOnly } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { Callout, Empty, Field, Fields, Grid, Panel, PanelBody } from '@/components/ui';
import { runAction } from '@/lib/actions';
import type { Key, Translator } from '@/lib/i18n';
import { ago } from '@/lib/time';

export interface FeedStateView {
  lastPolledAt: string | null;
  lastPostedAt: string | null;
  lastError: string | null;
  failures: number;
  paused: boolean;
  posted: number;
}

export interface PostView {
  id: string;
  feedId: string;
  title: string;
  url: string | null;
  channelId: string;
  postedAt: string;
}

const typeNames: Record<FeedType, Key> = {
  rss: 'RSS',
  youtube: 'YouTube',
  twitch: 'Twitch',
  reddit: 'Reddit',
  bluesky: 'Bluesky',
  github: 'GitHub',
  fluxer: 'Fluxer blog',
};

const sourceLabels: Record<FeedType, Key> = {
  rss: 'Feed address',
  youtube: 'Channel ID or link',
  twitch: 'Channel',
  reddit: 'Subreddit',
  bluesky: 'Handle',
  github: 'Repository',
  fluxer: 'Blog',
};

const defaultTemplates: Record<FeedType, Key> = {
  rss: '**{title}**\n{url}',
  youtube: '{author} posted a new video: **{title}**\n{url}',
  twitch: '{author} is live: **{title}**\n{url}',
  reddit: 'New in {feed}: **{title}**\n{url}',
  bluesky: '{author} posted on Bluesky\n{url}',
  github: '{feed} released **{title}**\n{url}',
  fluxer: 'New on the Fluxer blog: **{title}**\n{url}',
};

const samples: Record<
  FeedType,
  { title: Key; summary: Key; author: string; url: string; feed: string }
> = {
  rss: {
    title: 'Owls hunt by sound alone, new study finds',
    summary: 'Researchers tracked 40 barn owls through a full winter.',
    author: 'Birdwatch',
    url: 'https://birdwatch.example/owls',
    feed: 'Birdwatch',
  },
  youtube: {
    title: 'Inking a barn owl in 20 minutes',
    summary: 'Speed drawing with a fineliner.',
    author: 'Lena draws',
    url: 'https://www.youtube.com/watch?v=example',
    feed: 'YouTube',
  },
  twitch: {
    title: 'Counting to 5,000 with chat',
    summary: 'Playing Just Chatting',
    author: 'kai_plays',
    url: 'https://www.twitch.tv/kai_plays',
    feed: 'kai_plays',
  },
  reddit: {
    title: 'Who else is up at 3 am?',
    summary: 'Asking for a friend.',
    author: 'u/noor',
    url: 'https://www.reddit.com/r/nightowls/comments/example',
    feed: 'r/nightowls',
  },
  bluesky: {
    title: 'Movie night is back on Friday',
    summary: 'Movie night is back on Friday. Bring snacks.',
    author: 'Night Owls',
    url: 'https://bsky.app/profile/nightowls.bsky.social/post/example',
    feed: '@nightowls.bsky.social',
  },
  github: {
    title: 'v2.4.0',
    summary: 'Backups now keep 90 days.',
    author: 'maxwell',
    url: 'https://github.com/owner/repo/releases/tag/v2.4.0',
    feed: 'owner/repo',
  },
  fluxer: {
    title: 'Patch notes for October',
    summary: 'Threads for everyone.',
    author: 'Fluxer',
    url: 'https://fluxer.app/blog/october',
    feed: 'Fluxer blog',
  },
};

const errorText: Record<string, Key> = {
  invalid_source: 'The source is not a valid address or name.',
  blocked_url: 'The address is not a public https address.',
  not_found: 'The feed does not exist anymore.',
  not_a_feed: 'The address does not return a feed.',
  too_large: 'The feed is larger than 2 MB.',
  timeout: 'The feed took too long to answer.',
  unreachable: 'The feed could not be reached.',
  rate_limited: 'The feed is rate limiting requests.',
  redirects: 'The feed redirects too often.',
  twitch_unconfigured: 'Twitch is not set up on this Maxwell.',
  twitch_auth: 'Twitch rejected the credentials.',
  send_failed: 'I could not post in the target channel.',
  no_channel: 'No target channel is set.',
  http: 'The feed answered with an error.',
};

const intervals: { value: string; label: Key }[] = [
  { value: '5', label: '5 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '180', label: '3 hours' },
  { value: '720', label: '12 hours' },
  { value: '1440', label: '1 day' },
];

const pickButton: CSSProperties = {
  font: 'inherit',
  color: 'var(--mx-text)',
  background: 'transparent',
  border: 0,
  padding: 0,
  cursor: 'pointer',
  textAlign: 'left',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const tokenButton: CSSProperties = {
  border: 0,
  color: 'var(--mx-text-2)',
  cursor: 'pointer',
  padding: '4px 8px',
};

const sectionHead: CSSProperties = { borderTop: '1px solid var(--mx-line)', paddingTop: 14 };

function newId(taken: readonly string[]): string {
  for (;;) {
    const id = `feed-${Math.random().toString(36).slice(2, 8)}`;
    if (!taken.includes(id)) return id;
  }
}

function errorOf(t: Translator, code: string): string {
  const key = errorText[code];
  return key ? t(key) : code;
}

function feedLabel(t: Translator, feed: FeedSource): string {
  if (feed.name.trim()) return feed.name.trim();
  if (feed.type === 'fluxer') return t('Fluxer blog');
  if (feed.type === 'reddit' && feed.source.trim()) {
    const name = feed.source
      .trim()
      .replace(/^.*\/r\//, '')
      .replace(/^r\//, '')
      .split('/')[0];
    if (name) return `r/${name}`;
  }
  return feed.source.trim() || t('New source');
}

function safeUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function lastText(
  t: Translator,
  feed: FeedSource,
  state: FeedStateView | undefined,
  saved: boolean,
  now: number,
): { text: string; bad: boolean } {
  if (!saved) return { text: t('Not saved yet'), bad: false };
  if (state?.paused) return { text: t('Paused after errors'), bad: true };
  if (state?.lastError) {
    return { text: t('Failed: {error}', { error: errorOf(t, state.lastError) }), bad: true };
  }
  if (state?.lastPostedAt) return { text: ago(t, state.lastPostedAt, now), bad: false };
  if (state?.lastPolledAt) return { text: t('Nothing new yet'), bad: false };
  return { text: feed.enabled ? t('Not checked yet') : t('Off'), bad: false };
}

function Preview({ feed }: { feed: FeedSource }) {
  const t = useT();
  const channelName = useChannelName();
  const sample = samples[feed.type];
  const label = feed.name.trim() || sample.feed;
  const typeName = t(typeNames[feed.type]);
  const values = {
    title: t(sample.title),
    url: sample.url,
    author: sample.author,
    summary: t(sample.summary),
    feed: label,
    date: new Intl.DateTimeFormat(t.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(),
    ),
  };
  const template = feed.template.trim() || (feed.embed ? '' : t(defaultTemplates[feed.type]));
  const body = template.trim();
  const ping = feed.pingRoleId ? `<@&${feed.pingRoleId}>` : null;

  return (
    <div className="mx-preview" role="group" aria-label={t('Preview')}>
      <MessagePreview
        avatarSize={30}
        time={channelName(feed.channelId) || t('No channel')}
        content={[ping, body].filter(Boolean).join(' ')}
        vars={values}
      >
        {feed.embed ? (
          <EmbedPreview
            color="#3A9EEA"
            author={sample.author}
            title={<span style={{ color: '#6DB8F2' }}>{values.title}</span>}
            footer={label === typeName ? label : `${label} / ${typeName}`}
          >
            <span className="mx-sub">{values.summary}</span>
          </EmbedPreview>
        ) : null}
      </MessagePreview>
    </div>
  );
}

function Sources({
  feeds,
  selected,
  states,
  savedIds,
  now,
  canAdd,
  onAdd,
  onSelect,
  onToggle,
}: {
  feeds: FeedSource[];
  selected: string | null;
  states: Record<string, FeedStateView>;
  savedIds: string[];
  now: number;
  canAdd: boolean;
  onAdd: () => void;
  onSelect: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const t = useT();
  const channelName = useChannelName();
  const readOnly = useReadOnly();
  const active = feeds.filter((feed) => feed.enabled).length;
  return (
    <Panel
      title={t('Sources')}
      span={7}
      id="feeds-sources"
      actions={
        <>
          <span className="mx-sub">
            {t('{active} of {total} on', { active, total: feeds.length })}
          </span>
          {readOnly || !canAdd ? null : (
            <button type="button" className="mx-btn" onClick={onAdd}>
              {t('New')}
            </button>
          )}
        </>
      }
    >
      <div className="mx-scroll">
        <table className="mx-table">
          <thead>
            <tr>
              <th scope="col">{t('Source')}</th>
              <th scope="col">{t('Channel')}</th>
              <th scope="col">{t('Last post')}</th>
              <th scope="col">
                <span className="mx-sr">{t('On')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {feeds.map((feed) => {
              const last = lastText(t, feed, states[feed.id], savedIds.includes(feed.id), now);
              const label = feedLabel(t, feed);
              const picked = feed.id === selected;
              return (
                <tr key={feed.id}>
                  <td>
                    <button
                      type="button"
                      className="mx-pick"
                      aria-pressed={picked}
                      onClick={() => onSelect(feed.id)}
                      style={pickButton}
                    >
                      <span className="mx-chip" style={{ minWidth: 74, justifyContent: 'center' }}>
                        {t(typeNames[feed.type])}
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }}>{label}</span>
                        {feed.type !== 'fluxer' && feed.source.trim() !== label ? (
                          <span className="mx-sub" style={{ overflowWrap: 'anywhere' }}>
                            {feed.source}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </td>
                  <td className="mx-mono">{channelName(feed.channelId) || t('None')}</td>
                  <td>
                    <span className={last.bad ? 'mx-down' : 'mx-muted'}>{last.text}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Switch
                      order
                      checked={feed.enabled}
                      label={
                        feed.enabled
                          ? t('{name} on', { name: label })
                          : t('{name} off', { name: label })
                      }
                      onChange={(enabled) => onToggle(feed.id, enabled)}
                    />
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="mx-panel-head" style={sectionHead}>
        <h3>{title}</h3>
      </div>
      <PanelBody>{children}</PanelBody>
    </>
  );
}

function Editor({
  feed,
  saved,
  state,
  onChange,
  onDelete,
}: {
  feed: FeedSource;
  saved: boolean;
  state: FeedStateView | undefined;
  onChange: (patch: Partial<FeedSource>) => void;
  onDelete: () => void;
}) {
  const { guildId } = useGuild();
  const t = useT();
  const channelName = useChannelName();
  const readOnly = useReadOnly();
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();

  const run = (action: 'test' | 'resume', done: string) =>
    start(async () => {
      const result = await runAction(guildId, 'feeds', action, { feedId: feed.id });
      setStatus(
        result.ok ? { message: done, error: false } : { message: result.error, error: true },
      );
      if (result.ok && action === 'resume') setTimeout(() => router.refresh(), 2500);
    });

  const insert = (token: string) => {
    const base = feed.template || t(defaultTemplates[feed.type]);
    onChange({
      template: `${base}${base.endsWith('\n') || !base ? '' : ' '}${token}`.slice(0, 2000),
    });
  };

  const interval = String(feed.interval);
  const intervalOptions = intervals.map((option) => ({ ...option, label: t(option.label) }));

  return (
    <Panel
      title={feedLabel(t, feed)}
      span={5}
      id="feeds-edit"
      actions={
        readOnly ? null : (
          <>
            {saved ? (
              <button
                type="button"
                className="mx-btn"
                disabled={pending || !feed.channelId}
                onClick={() =>
                  run(
                    'test',
                    t('Posting the newest item in {channel}.', {
                      channel: channelName(feed.channelId),
                    }),
                  )
                }
              >
                {t('Test post')}
              </button>
            ) : null}
            <button type="button" className="mx-btn mx-btn-danger" onClick={onDelete}>
              {t('Delete')}
            </button>
          </>
        )
      }
    >
      <PanelBody>
        <StatusText status={status} />
        {state?.paused ? (
          <Callout
            tone="warn"
            action={
              readOnly ? null : (
                <button
                  type="button"
                  className="mx-btn"
                  disabled={pending}
                  onClick={() => run('resume', t('Resumed.'))}
                >
                  {t('Resume')}
                </button>
              )
            }
          >
            {t.plural(
              state.failures,
              'Paused after {n} failed check.',
              'Paused after {n} failed checks.',
            )}{' '}
            {state.lastError ? errorOf(t, state.lastError) : null}
          </Callout>
        ) : state?.lastError && saved ? (
          <Callout tone="warn">{errorOf(t, state.lastError)}</Callout>
        ) : null}
        <Fields>
          <Field label={t('Type')}>
            <Select
              value={feed.type}
              options={feedTypes.map((type) => ({ value: type, label: t(typeNames[type]) }))}
              onChange={(type) => onChange({ type })}
            />
          </Field>
          {feed.type === 'fluxer' ? (
            <div className="mx-field">
              <span className="mx-label">{t('Blog')}</span>
              <span style={{ minHeight: 36, display: 'flex', alignItems: 'center' }}>
                fluxer.app/blog
              </span>
            </div>
          ) : (
            <Field label={t(sourceLabels[feed.type])}>
              <TextInput
                value={feed.source}
                maxLength={500}
                placeholder={feedSourceHints[feed.type]}
                onChange={(source) => onChange({ source })}
              />
              {feed.source.trim() && !feedSourceValid(feed.type, feed.source) ? (
                <span className="mx-field-error">
                  {t('The source is not a valid address or name.')}
                </span>
              ) : null}
            </Field>
          )}
          <Field label={t('Name')}>
            <TextInput
              value={feed.name}
              maxLength={80}
              placeholder={feedLabel(t, { ...feed, name: '' })}
              onChange={(name) => onChange({ name })}
            />
          </Field>
          <Field label={t('Check every')}>
            <Select
              value={interval}
              options={
                intervals.some((option) => option.value === interval)
                  ? intervalOptions
                  : [
                      ...intervalOptions,
                      { value: interval, label: t('{count} minutes', { count: feed.interval }) },
                    ]
              }
              onChange={(next) => onChange({ interval: Number(next) })}
            />
          </Field>
        </Fields>
      </PanelBody>

      <Section title={t('Post')}>
        <Fields>
          <Field label={t('Channel')}>
            <ChannelSelect
              value={feed.channelId}
              none={t('Pick a channel')}
              onChange={(channelId) => onChange({ channelId })}
            />
          </Field>
          <Field label={t('Ping')}>
            <RoleSelect
              value={feed.pingRoleId}
              none={t('Nobody')}
              onChange={(pingRoleId) => onChange({ pingRoleId })}
            />
          </Field>
        </Fields>
        <Field label={t('Message')} aside={`${feed.template.length} / 2000`}>
          <TextArea
            value={feed.template}
            rows={3}
            maxLength={2000}
            placeholder={feed.embed ? t('Optional with an embed') : t(defaultTemplates[feed.type])}
            onChange={(template) => onChange({ template })}
          />
        </Field>
        {readOnly ? null : (
          <div className="mx-inline" style={{ gap: 6 }}>
            {feedTemplateVariables.map((name) => (
              <button
                key={name}
                type="button"
                className="mx-kbd"
                aria-label={t('Insert {token}', { token: name })}
                style={tokenButton}
                onClick={() => insert(`{${name}}`)}
              >
                {`{${name}}`}
              </button>
            ))}
          </div>
        )}
        <Fields>
          <ToggleRow
            order
            title={t('Show as embed')}
            checked={feed.embed}
            onChange={(embed) => onChange({ embed })}
          />
          {feed.type === 'youtube' ? (
            <ToggleRow
              order
              title={t('Include Shorts')}
              checked={feed.shorts}
              onChange={(shorts) => onChange({ shorts })}
            />
          ) : null}
          {feed.type === 'bluesky' ? (
            <ToggleRow
              order
              title={t('Include reposts')}
              checked={feed.reposts}
              onChange={(reposts) => onChange({ reposts })}
            />
          ) : null}
        </Fields>
      </Section>

      <Section title={t('Filters')}>
        <div className="mx-field">
          <span className="mx-label">{t('Only posts with')}</span>
          <WordList
            value={feed.include}
            placeholder={t('Any words')}
            onChange={(include) => onChange({ include: include.slice(0, 50) })}
          />
          {readOnly && feed.include.length === 0 ? (
            <span className="mx-sub">{t('Any words')}</span>
          ) : null}
        </div>
        <div className="mx-field">
          <span className="mx-label">{t('Skip posts with')}</span>
          <WordList
            value={feed.exclude}
            placeholder={t('None')}
            onChange={(exclude) => onChange({ exclude: exclude.slice(0, 50) })}
          />
          {readOnly && feed.exclude.length === 0 ? (
            <span className="mx-sub">{t('None')}</span>
          ) : null}
        </div>
      </Section>

      <Section title={t('Preview')}>
        <Preview feed={feed} />
      </Section>
    </Panel>
  );
}

function Recent({ posts, feeds, now }: { posts: PostView[]; feeds: FeedSource[]; now: number }) {
  const t = useT();
  const channelName = useChannelName();
  return (
    <Panel title={t('Recent posts')} span={12} id="feeds-recent">
      <div className="mx-scroll">
        <table className="mx-table">
          <thead>
            <tr>
              <th scope="col">{t('Post')}</th>
              <th scope="col">{t('Source')}</th>
              <th scope="col">{t('Channel')}</th>
              <th scope="col">{t('Posted')}</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => {
              const feed = feeds.find((entry) => entry.id === post.feedId);
              const url = safeUrl(post.url);
              return (
                <tr key={post.id}>
                  <td style={{ overflowWrap: 'anywhere' }}>
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer noopener">
                        {post.title}
                      </a>
                    ) : (
                      post.title
                    )}
                  </td>
                  <td>{feed ? feedLabel(t, feed) : t('Removed source')}</td>
                  <td className="mx-mono">{channelName(post.channelId)}</td>
                  <td className="mx-muted" style={{ whiteSpace: 'nowrap' }}>
                    {ago(t, post.postedAt, now)}
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

export function FeedsForm({
  now,
  savedIds,
  states,
  posts,
}: {
  now: number;
  savedIds: string[];
  states: Record<string, FeedStateView>;
  posts: PostView[];
}) {
  const t = useT();
  const { value, update, readOnly } = useDraft<FeedsConfig>();
  const { channels } = useGuild();
  const [selected, setSelected] = useState<string | null>(value.feeds[0]?.id ?? null);
  const current = value.feeds.find((feed) => feed.id === selected) ?? value.feeds[0] ?? null;

  const patch = (id: string, change: Partial<FeedSource>) =>
    update((previous) => ({
      ...previous,
      feeds: previous.feeds.map((feed) => (feed.id === id ? { ...feed, ...change } : feed)),
    }));

  const add = () => {
    const id = newId(value.feeds.map((feed) => feed.id));
    const channel = channels.find(
      (entry) => entry.type === ChannelType.Text || entry.type === ChannelType.Announcement,
    );
    const feed: FeedSource = {
      id,
      type: 'rss',
      source: '',
      name: '',
      channelId: channel?.id ?? null,
      template: '',
      embed: true,
      pingRoleId: null,
      include: [],
      exclude: [],
      interval: 15,
      shorts: true,
      reposts: false,
      enabled: true,
    };
    update((previous) => ({ ...previous, feeds: [...previous.feeds, feed] }));
    setSelected(id);
  };

  const remove = () => {
    if (!current) return;
    const rest = value.feeds.filter((feed) => feed.id !== current.id);
    update((previous) => ({
      ...previous,
      feeds: previous.feeds.filter((feed) => feed.id !== current.id),
    }));
    setSelected(rest[0]?.id ?? null);
  };

  return (
    <Grid>
      {current ? (
        <>
          <Sources
            feeds={value.feeds}
            selected={current.id}
            states={states}
            savedIds={savedIds}
            now={now}
            canAdd={value.feeds.length < FEED_LIMIT}
            onAdd={add}
            onSelect={setSelected}
            onToggle={(id, enabled) => patch(id, { enabled })}
          />
          <Editor
            key={current.id}
            feed={current}
            saved={savedIds.includes(current.id)}
            state={states[current.id]}
            onChange={(change) => patch(current.id, change)}
            onDelete={remove}
          />
        </>
      ) : (
        <Panel id="feeds-empty">
          <Empty
            mood="sleeping"
            action={
              readOnly ? null : (
                <button type="button" className="mx-btn mx-btn-primary" onClick={add}>
                  {t('Add a source')}
                </button>
              )
            }
          >
            {t('No feeds yet.')}
          </Empty>
        </Panel>
      )}
      {posts.length > 0 ? <Recent posts={posts} feeds={value.feeds} now={now} /> : null}
    </Grid>
  );
}
