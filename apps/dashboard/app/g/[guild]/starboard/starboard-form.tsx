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
import { useT } from '@/components/i18n';
import { EmbedPreview, Markdown, MessagePreview } from '@/components/message-preview';
import { useDraft } from '@/components/module-shell';
import { Avatar, Empty, Field, Fields, Grid, Panel, PanelBody, Row } from '@/components/ui';
import type { Key } from '@/lib/i18n';

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

const presets: { value: string; label: Key; one: Key; other: Key }[] = [
  { value: '⭐', label: 'Star', one: '{n} star', other: '{n} stars' },
  { value: '🔥', label: 'Fire', one: '{n} fire', other: '{n} fires' },
  { value: '❤️', label: 'Heart', one: '{n} heart', other: '{n} hearts' },
];

const periods: { value: Period; label: Key }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All time' },
];

function Reaction() {
  const t = useT();
  const { value, set } = useDraft<StarboardConfig>();
  const preset = presets.some((entry) => entry.value === value.emoji);
  const [custom, setCustom] = useState(!preset);
  const mode = custom || !preset ? 'custom' : value.emoji;
  const options = [
    ...presets.map((entry) => ({ value: entry.value, label: t(entry.label) })),
    { value: 'custom', label: t('Custom') },
  ];
  return (
    <>
      <Field label={t('Reaction')}>
        <Select
          label={t('Reaction')}
          value={mode}
          options={options}
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
        <Field label={t('Custom emoji')}>
          <TextInput
            mono
            label={t('Custom emoji')}
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
  const t = useT();
  const { value } = useDraft<StarboardConfig>();
  const channelName = useChannelName();
  const preset = presets.find((entry) => entry.value === value.emoji);
  const stars = Math.max(value.threshold, post?.stars ?? value.threshold);
  const word = preset
    ? t.plural(stars, preset.one, preset.other)
    : t.plural(stars, '{n} reaction', '{n} reactions');
  const where = post ? channelName(post.channelId) : '#general';
  return (
    <div className="mx-preview">
      <MessagePreview content={`**${word}** ${t('in {channel}', { channel: where })}`}>
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
          <Markdown text={post ? post.content || t('Image') : t('This one deserves a star.')} />
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
              {t('Image')}
            </div>
          ) : null}
          <span style={{ fontSize: 13, color: '#3A9EEA' }}>{t('Jump to message')}</span>
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
  const t = useT();
  const { value, set } = useDraft<StarboardConfig>();
  const channelName = useChannelName();
  const [period, setPeriod] = useState<Period>('month');
  const list = top[period];
  const sample = top.month[0] ?? top.all[0] ?? null;
  const sampleAuthor = sample ? (people[sample.authorId] ?? viewer) : viewer;
  const person = (id: string) => people[id]?.name ?? t('Unknown member');

  const toggles: { key: keyof StarboardConfig; label: string }[] = [
    { key: 'selfStar', label: t('Count stars on your own post') },
    { key: 'excludeNsfw', label: t('Ignore NSFW channels') },
    { key: 'allowBots', label: t('Allow posts from bots') },
    { key: 'removeBelowThreshold', label: t('Remove when stars drop below the limit') },
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
            <span className="mx-stat-label">{t('Starred in 30 days')}</span>
            <span className="mx-stat-value">{t.count(summary.posts)}</span>
            {summary.delta !== 0 ? (
              <span className="mx-sub">
                <span className={summary.delta > 0 ? 'mx-up' : 'mx-down'}>
                  {summary.delta > 0 ? `+${t.count(summary.delta)}` : `-${t.count(-summary.delta)}`}
                </span>{' '}
                {t('vs the 30 days before')}
              </span>
            ) : null}
          </div>
          <div className="mx-stat">
            <span className="mx-stat-label">{t('Stars given')}</span>
            <span className="mx-stat-value">{t.count(summary.stars)}</span>
            <span className="mx-sub">{t('{count} all time', { count: summary.allStars })}</span>
          </div>
          {summary.topChannel ? (
            <div className="mx-stat">
              <span className="mx-stat-label">{t('Top channel')}</span>
              <span className="mx-stat-value mx-ellipsis">
                {channelName(summary.topChannel.id)}
              </span>
              <span className="mx-sub">
                {t.plural(summary.topChannel.posts, '{n} post', '{n} posts')}
              </span>
            </div>
          ) : null}
          {summary.topAuthor ? (
            <div className="mx-stat">
              <span className="mx-stat-label">{t('Most starred member')}</span>
              <span className="mx-stat-value mx-ellipsis">{person(summary.topAuthor.id)}</span>
              <span className="mx-sub">
                {t.plural(summary.topAuthor.posts, '{n} post', '{n} posts')}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <Grid>
        <Panel title={t('Settings')} span={5} id="sb-set">
          <PanelBody>
            <Fields>
              <Field label={t('Channel')}>
                <ChannelSelect
                  value={value.channelId}
                  onChange={(channelId) => set({ channelId })}
                />
              </Field>
              <Reaction />
              <Field label={t('Stars needed')}>
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
              <span className="mx-label">{t('Ignored channels')}</span>
              <ChannelMulti
                value={value.ignoredChannelIds}
                onChange={(ignoredChannelIds) => set({ ignoredChannelIds })}
              />
            </div>
          </div>
        </Panel>

        <div className="mx-s7 mx-stack" style={{ gap: 16, minWidth: 0 }}>
          <Panel
            title={t('Preview')}
            id="sb-prev"
            actions={
              <span className="mx-sub">
                {value.channelId ? channelName(value.channelId) : t('No channel')}
              </span>
            }
          >
            <PanelBody>
              <Preview post={sample} author={sampleAuthor} />
            </PanelBody>
          </Panel>

          <Panel
            title={t('Top posts')}
            id="sb-top"
            actions={
              top.all.length > 0 ? (
                <Seg
                  label={t('Period')}
                  value={period}
                  options={periods.map((option) => ({ ...option, label: t(option.label) }))}
                  onChange={setPeriod}
                  view
                />
              ) : null
            }
          >
            {top.all.length === 0 ? (
              <Empty mood="sleeping">{t('No starred posts yet.')}</Empty>
            ) : list.length === 0 ? (
              <Empty>{t('Nothing starred in this period.')}</Empty>
            ) : (
              list.map((post) => {
                const author = people[post.authorId];
                return (
                  <Row
                    key={post.messageId}
                    leading={
                      <>
                        <span className="mx-stat-value" style={{ fontSize: 16, width: 44 }}>
                          {t.count(post.stars)}
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
                        {post.content || t('Image')}
                      </span>
                    }
                    sub={t('{name} in {channel}', {
                      name: person(post.authorId),
                      channel: channelName(post.channelId),
                    })}
                  >
                    <a
                      className="mx-pick mx-sub"
                      href={post.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t('Open the post by {name}', { name: person(post.authorId) })}
                    >
                      {t('View')}
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
