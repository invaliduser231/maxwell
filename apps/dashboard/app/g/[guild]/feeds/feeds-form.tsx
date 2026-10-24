'use client';

import {
  FEED_LIMIT,
  type FeedSource,
  type FeedsConfig,
  type FeedType,
  feedSourceHints,
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
import { EmbedPreview, MessagePreview } from '@/components/message-preview';
import { useDraft, useReadOnly } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { Callout, Empty, Field, Fields, Grid, Panel, PanelBody } from '@/components/ui';
import { runAction } from '@/lib/actions';
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

const typeNames: Record<FeedType, string> = {
  rss: 'RSS',
  youtube: 'YouTube',
  twitch: 'Twitch',
  reddit: 'Reddit',
  bluesky: 'Bluesky',
  github: 'GitHub',
  fluxer: 'Fluxer blog',
};

const sourceLabels: Record<FeedType, string> = {
  rss: 'Feed address',
  youtube: 'Channel ID or link',
  twitch: 'Channel',
  reddit: 'Subreddit',
  bluesky: 'Handle',
  github: 'Repository',
  fluxer: 'Blog',
};

const defaultTemplates: Record<FeedType, string> = {
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
  { title: string; summary: string; author: string; url: string; feed: string }
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

const errorText: Record<string, string> = {
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

const intervals = [
  { value: '5', label: '5 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '180', label: '3 hours' },
  { value: '720', label: '12 hours' },
  { value: '1440', label: '1 day' },
];

const typeOptions = feedTypes.map((type) => ({ value: type, label: typeNames[type] }));

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

function feedLabel(feed: FeedSource): string {
  if (feed.name.trim()) return feed.name.trim();
  if (feed.type === 'fluxer') return 'Fluxer blog';
  if (feed.type === 'reddit' && feed.source.trim()) {
    const name = feed.source
      .trim()
      .replace(/^.*\/r\//, '')
      .replace(/^r\//, '')
      .split('/')[0];
    if (name) return `r/${name}`;
  }
  return feed.source.trim() || 'New source';
}

function safeUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function lastText(
  feed: FeedSource,
  state: FeedStateView | undefined,
  saved: boolean,
  now: number,
): { text: string; bad: boolean } {
  if (!saved) return { text: 'Not saved yet', bad: false };
  if (state?.paused) return { text: 'Paused after errors', bad: true };
  if (state?.lastError) {
    return { text: `Failed: ${errorText[state.lastError] ?? state.lastError}`, bad: true };
  }
  if (state?.lastPostedAt) return { text: ago(state.lastPostedAt, now), bad: false };
  if (state?.lastPolledAt) return { text: 'Nothing new yet', bad: false };
  return { text: feed.enabled ? 'Not checked yet' : 'Off', bad: false };
}

function Preview({ feed }: { feed: FeedSource }) {
  const channelName = useChannelName();
  const sample = samples[feed.type];
  const label = feed.name.trim() || sample.feed;
  const values = {
    title: sample.title,
    url: sample.url,
    author: sample.author,
    summary: sample.summary,
    feed: label,
    date: new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(),
    ),
  };
  const template = feed.template.trim() || (feed.embed ? '' : defaultTemplates[feed.type]);
  const body = template.trim();
  const ping = feed.pingRoleId ? `<@&${feed.pingRoleId}>` : null;

  return (
    <div className="mx-preview" role="group" aria-label="Preview">
      <MessagePreview
        avatarSize={30}
        time={channelName(feed.channelId) || 'No channel'}
        content={[ping, body].filter(Boolean).join(' ')}
        vars={values}
      >
        {feed.embed ? (
          <EmbedPreview
            color="#3A9EEA"
            author={sample.author}
            title={<span style={{ color: '#6DB8F2' }}>{sample.title}</span>}
            footer={label === typeNames[feed.type] ? label : `${label} / ${typeNames[feed.type]}`}
          >
            <span className="mx-sub">{sample.summary}</span>
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
  const channelName = useChannelName();
  const readOnly = useReadOnly();
  const active = feeds.filter((feed) => feed.enabled).length;
  return (
    <Panel
      title="Sources"
      span={7}
      id="feeds-sources"
      actions={
        <>
          <span className="mx-sub">{`${active} of ${feeds.length} on`}</span>
          {readOnly || !canAdd ? null : (
            <button type="button" className="mx-btn" onClick={onAdd}>
              New
            </button>
          )}
        </>
      }
    >
      <div className="mx-scroll">
        <table className="mx-table">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Channel</th>
              <th scope="col">Last post</th>
              <th scope="col">
                <span className="mx-sr">On</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {feeds.map((feed) => {
              const last = lastText(feed, states[feed.id], savedIds.includes(feed.id), now);
              const label = feedLabel(feed);
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
                        {typeNames[feed.type]}
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
                  <td className="mx-mono">{channelName(feed.channelId) || 'None'}</td>
                  <td>
                    <span className={last.bad ? 'mx-down' : 'mx-muted'}>{last.text}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Switch
                      order
                      checked={feed.enabled}
                      label={`${label} ${feed.enabled ? 'on' : 'off'}`}
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
    const base = feed.template || defaultTemplates[feed.type];
    onChange({
      template: `${base}${base.endsWith('\n') || !base ? '' : ' '}${token}`.slice(0, 2000),
    });
  };

  const interval = String(feed.interval);

  return (
    <Panel
      title={feedLabel(feed)}
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
                  run('test', `Posting the newest item in ${channelName(feed.channelId)}.`)
                }
              >
                Test post
              </button>
            ) : null}
            <button type="button" className="mx-btn mx-btn-danger" onClick={onDelete}>
              Delete
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
                  onClick={() => run('resume', 'Resumed.')}
                >
                  Resume
                </button>
              )
            }
          >
            Paused after {state.failures} failed checks.{' '}
            {state.lastError ? (errorText[state.lastError] ?? state.lastError) : null}
          </Callout>
        ) : state?.lastError && saved ? (
          <Callout tone="warn">{errorText[state.lastError] ?? state.lastError}</Callout>
        ) : null}
        <Fields>
          <Field label="Type">
            <Select
              value={feed.type}
              options={typeOptions}
              onChange={(type) => onChange({ type })}
            />
          </Field>
          {feed.type === 'fluxer' ? (
            <div className="mx-field">
              <span className="mx-label">Blog</span>
              <span style={{ minHeight: 36, display: 'flex', alignItems: 'center' }}>
                fluxer.app/blog
              </span>
            </div>
          ) : (
            <Field label={sourceLabels[feed.type]}>
              <TextInput
                value={feed.source}
                maxLength={500}
                placeholder={feedSourceHints[feed.type]}
                onChange={(source) => onChange({ source })}
              />
            </Field>
          )}
          <Field label="Name">
            <TextInput
              value={feed.name}
              maxLength={80}
              placeholder={feedLabel({ ...feed, name: '' })}
              onChange={(name) => onChange({ name })}
            />
          </Field>
          <Field label="Check every">
            <Select
              value={interval}
              options={
                intervals.some((option) => option.value === interval)
                  ? intervals
                  : [...intervals, { value: interval, label: `${interval} minutes` }]
              }
              onChange={(next) => onChange({ interval: Number(next) })}
            />
          </Field>
        </Fields>
      </PanelBody>

      <Section title="Post">
        <Fields>
          <Field label="Channel">
            <ChannelSelect
              value={feed.channelId}
              none="Pick a channel"
              onChange={(channelId) => onChange({ channelId })}
            />
          </Field>
          <Field label="Ping">
            <RoleSelect
              value={feed.pingRoleId}
              none="Nobody"
              onChange={(pingRoleId) => onChange({ pingRoleId })}
            />
          </Field>
        </Fields>
        <Field label="Message" aside={`${feed.template.length} / 2000`}>
          <TextArea
            value={feed.template}
            rows={3}
            maxLength={2000}
            placeholder={feed.embed ? 'Optional with an embed' : defaultTemplates[feed.type]}
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
                aria-label={`Insert ${name}`}
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
            title="Show as embed"
            checked={feed.embed}
            onChange={(embed) => onChange({ embed })}
          />
          {feed.type === 'youtube' ? (
            <ToggleRow
              order
              title="Include Shorts"
              checked={feed.shorts}
              onChange={(shorts) => onChange({ shorts })}
            />
          ) : null}
          {feed.type === 'bluesky' ? (
            <ToggleRow
              order
              title="Include reposts"
              checked={feed.reposts}
              onChange={(reposts) => onChange({ reposts })}
            />
          ) : null}
        </Fields>
      </Section>

      <Section title="Filters">
        <div className="mx-field">
          <span className="mx-label">Only posts with</span>
          <WordList
            value={feed.include}
            placeholder="Any words"
            onChange={(include) => onChange({ include: include.slice(0, 50) })}
          />
          {readOnly && feed.include.length === 0 ? <span className="mx-sub">Any words</span> : null}
        </div>
        <div className="mx-field">
          <span className="mx-label">Skip posts with</span>
          <WordList
            value={feed.exclude}
            placeholder="None"
            onChange={(exclude) => onChange({ exclude: exclude.slice(0, 50) })}
          />
          {readOnly && feed.exclude.length === 0 ? <span className="mx-sub">None</span> : null}
        </div>
      </Section>

      <Section title="Preview">
        <Preview feed={feed} />
      </Section>
    </Panel>
  );
}

function Recent({ posts, feeds, now }: { posts: PostView[]; feeds: FeedSource[]; now: number }) {
  const channelName = useChannelName();
  return (
    <Panel title="Recent posts" span={12} id="feeds-recent">
      <div className="mx-scroll">
        <table className="mx-table">
          <thead>
            <tr>
              <th scope="col">Post</th>
              <th scope="col">Source</th>
              <th scope="col">Channel</th>
              <th scope="col">Posted</th>
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
                  <td>{feed ? feedLabel(feed) : 'Removed source'}</td>
                  <td className="mx-mono">{channelName(post.channelId)}</td>
                  <td className="mx-muted" style={{ whiteSpace: 'nowrap' }}>
                    {ago(post.postedAt, now)}
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
                  Add a source
                </button>
              )
            }
          >
            No feeds yet.
          </Empty>
        </Panel>
      )}
      {posts.length > 0 ? <Recent posts={posts} feeds={value.feeds} now={now} /> : null}
    </Grid>
  );
}
