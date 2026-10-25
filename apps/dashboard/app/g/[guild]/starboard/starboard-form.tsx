'use client';

import type { StarboardConfig } from '@maxwell/core/modules/starboard';
import { useState } from 'react';
import {
  ChannelMulti,
  ChannelSelect,
  NumberInput,
  Seg,
  Select,
  Switch,
  TextInput,
} from '@/components/controls';
import { useChannelName } from '@/components/guild';
import { EmbedPreview, Markdown, MessagePreview } from '@/components/message-preview';
import { useDraft } from '@/components/module-shell';
import { Avatar, Empty, Field, Fields, Grid, Panel, PanelBody, Row } from '@/components/ui';
import { count, plural } from '@/lib/time';

export interface Author {
  name: string;
  username: string | null;
  avatarUrl: string | null;
}

export interface TopPost {
  messageId: string;
  channelId: string;
  authorId: string;
  stars: number;
  content: string;
  image: boolean;
  createdAt: string;
  url: string;
}

export interface Summary {
  posts: number;
  delta: number;
  stars: number;
  allStars: number;
  topChannel: { id: string; posts: number } | null;
  topAuthor: { id: string; posts: number } | null;
}

type Period = 'week' | 'month' | 'all';

const presets = [
  { value: '⭐', label: 'Star', plural: 'stars' },
  { value: '🔥', label: 'Fire', plural: 'fires' },
  { value: '❤️', label: 'Heart', plural: 'hearts' },
] as const;

const periods = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All time' },
] as const;

const reactionOptions = [
  ...presets.map((entry) => ({ value: entry.value as string, label: entry.label })),
  { value: 'custom', label: 'Custom' },
];

function Reaction() {
  const { value, set } = useDraft<StarboardConfig>();
  const preset = presets.some((entry) => entry.value === value.emoji);
  const [custom, setCustom] = useState(!preset);
  const mode = custom || !preset ? 'custom' : value.emoji;
  return (
    <>
      <Field label="Reaction">
        <Select
          label="Reaction"
          value={mode}
          options={reactionOptions}
          onChange={(next) => {
            if (next === 'custom') {
              setCustom(true);
              return;
            }
            setCustom(false);
            set({ emoji: next });
          }}
        />
      </Field>
      {mode === 'custom' ? (
        <Field label="Custom emoji">
          <TextInput
            mono
            label="Custom emoji"
            placeholder="name:id"
            maxLength={80}
            value={preset ? '' : value.emoji}
            onChange={(emoji) => set({ emoji: emoji.trim() })}
          />
        </Field>
      ) : null}
    </>
  );
}

function Preview({ post, author }: { post: TopPost | null; author: Author }) {
  const { value } = useDraft<StarboardConfig>();
  const channelName = useChannelName();
  const word = presets.find((entry) => entry.value === value.emoji)?.plural ?? 'reactions';
  const stars = Math.max(value.threshold, post?.stars ?? value.threshold);
  const where = post ? channelName(post.channelId) : '#general';
  return (
    <div className="mx-preview">
      <MessagePreview content={`**${count(stars)} ${word}** in ${where}`}>
        <EmbedPreview color="#F26B3A">
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <Avatar src={author.avatarUrl} name={author.name} size={20} />
            {author.username ? `${author.name} (@${author.username})` : author.name}
          </span>
          <Markdown text={post ? post.content || 'Image' : 'This one deserves a star.'} />
          {post?.image ? (
            <div
              aria-hidden="true"
              style={{
                height: 120,
                borderRadius: 6,
                background: 'var(--mx-raised)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--mx-muted)',
                fontSize: 13,
              }}
            >
              Image
            </div>
          ) : null}
          <span style={{ fontSize: 13, color: '#3A9EEA' }}>Jump to message</span>
        </EmbedPreview>
      </MessagePreview>
    </div>
  );
}

export function StarboardForm({
  summary,
  top,
  people,
  viewer,
}: {
  summary: Summary;
  top: Record<Period, TopPost[]>;
  people: Record<string, Author>;
  viewer: Author;
}) {
  const { value, set } = useDraft<StarboardConfig>();
  const channelName = useChannelName();
  const [period, setPeriod] = useState<Period>('month');
  const list = top[period];
  const sample = top.month[0] ?? top.all[0] ?? null;
  const sampleAuthor = sample ? (people[sample.authorId] ?? viewer) : viewer;
  const person = (id: string) => people[id]?.name ?? 'Unknown member';

  const toggles: { key: keyof StarboardConfig; label: string }[] = [
    { key: 'selfStar', label: 'Count stars on your own post' },
    { key: 'excludeNsfw', label: 'Ignore NSFW channels' },
    { key: 'allowBots', label: 'Allow posts from bots' },
    { key: 'removeBelowThreshold', label: 'Remove when stars drop below the limit' },
  ];

  const hasStats = summary.posts > 0 || summary.allStars > 0 || top.all.length > 0;
  const recent = summary.posts > 0 || summary.delta !== 0;

  return (
    <>
      {hasStats ? (
        <div
          className={recent ? 'mx-panel' : 'mx-panel mx-stat-quiet'}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
        >
          <div className="mx-stat">
            <span className="mx-stat-label">Starred in 30 days</span>
            <span className="mx-stat-value">{count(summary.posts)}</span>
            {summary.delta !== 0 ? (
              <span className="mx-sub">
                <span className={summary.delta > 0 ? 'mx-up' : 'mx-down'}>
                  {summary.delta > 0 ? `+${count(summary.delta)}` : `-${count(-summary.delta)}`}
                </span>{' '}
                vs the 30 days before
              </span>
            ) : null}
          </div>
          <div className="mx-stat">
            <span className="mx-stat-label">Stars given</span>
            <span className="mx-stat-value">{count(summary.stars)}</span>
            <span className="mx-sub">{count(summary.allStars)} all time</span>
          </div>
          {summary.topChannel ? (
            <div className="mx-stat">
              <span className="mx-stat-label">Top channel</span>
              <span className="mx-stat-value mx-ellipsis">
                {channelName(summary.topChannel.id)}
              </span>
              <span className="mx-sub">{plural(summary.topChannel.posts, 'post')}</span>
            </div>
          ) : null}
          {summary.topAuthor ? (
            <div className="mx-stat">
              <span className="mx-stat-label">Most starred member</span>
              <span className="mx-stat-value mx-ellipsis">{person(summary.topAuthor.id)}</span>
              <span className="mx-sub">{plural(summary.topAuthor.posts, 'post')}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <Grid>
        <Panel title="Settings" span={5} id="sb-set">
          <PanelBody>
            <Fields>
              <Field label="Channel">
                <ChannelSelect
                  value={value.channelId}
                  onChange={(channelId) => set({ channelId })}
                />
              </Field>
              <Reaction />
              <Field label="Stars needed">
                <NumberInput
                  value={value.threshold}
                  min={1}
                  max={100}
                  onChange={(threshold) => set({ threshold })}
                />
              </Field>
            </Fields>
          </PanelBody>
          {toggles.map((toggle) => (
            <Row key={toggle.key} title={toggle.label}>
              <Switch
                label={toggle.label}
                checked={value[toggle.key] === true}
                onChange={(next) => set({ [toggle.key]: next })}
              />
            </Row>
          ))}
          <div className="mx-panel-body" style={{ borderTop: '1px solid var(--mx-line)' }}>
            <div className="mx-field">
              <span className="mx-label">Ignored channels</span>
              <ChannelMulti
                value={value.ignoredChannelIds}
                onChange={(ignoredChannelIds) => set({ ignoredChannelIds })}
              />
            </div>
          </div>
        </Panel>

        <div className="mx-s7 mx-stack" style={{ gap: 16, minWidth: 0 }}>
          <Panel
            title="Preview"
            id="sb-prev"
            actions={
              <span className="mx-sub">
                {value.channelId ? channelName(value.channelId) : 'No channel'}
              </span>
            }
          >
            <PanelBody>
              <Preview post={sample} author={sampleAuthor} />
            </PanelBody>
          </Panel>

          <Panel
            title="Top posts"
            id="sb-top"
            actions={
              top.all.length > 0 ? (
                <Seg label="Period" value={period} options={periods} onChange={setPeriod} view />
              ) : null
            }
          >
            {top.all.length === 0 ? (
              <Empty mood="sleeping">No starred posts yet.</Empty>
            ) : list.length === 0 ? (
              <Empty>Nothing starred in this period.</Empty>
            ) : (
              list.map((post) => {
                const author = people[post.authorId];
                return (
                  <Row
                    key={post.messageId}
                    leading={
                      <>
                        <span className="mx-stat-value" style={{ fontSize: 16, width: 44 }}>
                          {count(post.stars)}
                        </span>
                        <Avatar
                          src={author?.avatarUrl ?? null}
                          name={author?.name ?? '?'}
                          size={26}
                        />
                      </>
                    }
                    title={
                      <span className="mx-ellipsis" style={{ display: 'block', fontWeight: 400 }}>
                        {post.content || 'Image'}
                      </span>
                    }
                    sub={`${person(post.authorId)} in ${channelName(post.channelId)}`}
                  >
                    <a
                      className="mx-btn mx-btn-ghost"
                      href={post.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open the post by ${person(post.authorId)}`}
                    >
                      Open
                    </a>
                  </Row>
                );
              })
            )}
          </Panel>
        </div>
      </Grid>
    </>
  );
}
