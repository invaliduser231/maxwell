'use client';

import type { InsightsConfig } from '@maxwell/core/modules/insights';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ChannelMulti, ChannelSelect, Seg, Select, Switch } from '@/components/controls';
import { ChannelType, useChannelName, useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { useDraft } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { Empty, Field, Fields, Grid, Panel, PanelBody, Row } from '@/components/ui';
import { runAction } from '@/lib/actions';
import type { Key, Translator } from '@/lib/i18n';

export type RangeDays = 7 | 30 | 90;

export interface DayPoint {
  day: string;
  messages: number;
  joins: number;
  leaves: number;
  active: number;
}

export interface Heat {
  weekday: number;
  hour: number;
  messages: number;
}

export interface Week {
  start: string;
  total: number;
  automod: number;
}

export interface Retention {
  code: string | null;
  inviter: string | null;
  joins: number;
  eligible7: number;
  stayed7: number;
  eligible30: number;
  stayed30: number;
  active30: number;
}

const BLUE = '#3A9EEA';
const ORANGE = '#F26B3A';
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const ranges: { value: RangeDays; label: Key }[] = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];
const keepFor: { value: string; label: Key }[] = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '6 months' },
  { value: '365', label: '1 year' },
  { value: '730', label: '2 years' },
];

function weekdayNames(locale: string, weekday: 'short' | 'long' = 'short'): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday, timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, index) =>
    format.format(new Date(Date.UTC(2024, 0, 1 + index))),
  );
}

function dayLabel(locale: string, day: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

function percentTrend(now: number, before: number): { text: string; up: boolean } | null {
  if (before === 0) return null;
  const change = Math.round(((now - before) / before) * 100);
  return { text: `${change >= 0 ? '+' : ''}${change}%`, up: change >= 0 };
}

function countTrend(t: Translator, now: number, before: number): { text: string; up: boolean } {
  const change = now - before;
  return { text: `${change >= 0 ? '+' : ''}${t.count(change)}`, up: change >= 0 };
}

function share(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

function rateColor(value: number): string {
  return value >= 70 ? '#2EB67D' : value >= 45 ? '#F2C14E' : '#EC5B78';
}

function RangePicker({ days, data }: { days: RangeDays; data: boolean }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const { guildId } = useGuild();
  const [pending, start] = useTransition();
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}
    >
      <Seg
        label={t('Range')}
        value={String(days)}
        options={ranges.map((range) => ({ value: String(range.value), label: t(range.label) }))}
        disabled={pending}
        view
        onChange={(next) => start(() => router.push(`${pathname}?range=${next}`))}
      />
      {data ? (
        <a className="mx-btn" href={`/g/${guildId}/insights/export?range=${days}`} download>
          {t('Export CSV')}
        </a>
      ) : null}
    </div>
  );
}

function Stats({
  stats,
  retention,
  quiet,
}: {
  stats: Record<'active' | 'messages' | 'joins' | 'leaves', [number, number]>;
  retention: Retention[];
  quiet: boolean;
}) {
  const t = useT();
  const eligible = retention.reduce((sum, row) => sum + row.eligible30, 0);
  const stayed = retention.reduce((sum, row) => sum + row.stayed30, 0);
  const kept = share(stayed, eligible);
  const leaves = countTrend(t, stats.leaves[0], stats.leaves[1]);
  const items: {
    label: string;
    value: string;
    trend: { text: string; good: boolean } | null;
    note?: string;
  }[] = [
    {
      label: t('Active members'),
      value: t.count(stats.active[0]),
      trend: (() => {
        const trend = percentTrend(stats.active[0], stats.active[1]);
        return trend ? { text: trend.text, good: trend.up } : null;
      })(),
    },
    {
      label: t('Messages'),
      value: t.count(stats.messages[0]),
      trend: (() => {
        const trend = percentTrend(stats.messages[0], stats.messages[1]);
        return trend ? { text: trend.text, good: trend.up } : null;
      })(),
    },
    {
      label: t('Joins'),
      value: t.count(stats.joins[0]),
      trend: (() => {
        const trend = countTrend(t, stats.joins[0], stats.joins[1]);
        return { text: trend.text, good: trend.up };
      })(),
    },
    {
      label: t('Leaves'),
      value: t.count(stats.leaves[0]),
      trend: { text: leaves.text, good: !leaves.up || stats.leaves[0] === stats.leaves[1] },
    },
    {
      label: t('Still here after 30 days'),
      value: `${kept ?? 0}%`,
      trend: null,
      note: kept === null ? t('Needs joins from a month ago') : t('Invited members, last 90 days'),
    },
  ];
  return (
    <div
      className={quiet ? 'mx-panel mx-stat-quiet' : 'mx-panel'}
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
    >
      {items.map((item) => (
        <div key={item.label} className="mx-stat">
          <span className="mx-stat-label">{item.label}</span>
          <span className="mx-stat-value">{item.value}</span>
          {quiet ? null : item.trend ? (
            <span className="mx-sub">
              <span className={item.trend.good ? 'mx-up' : 'mx-down'}>{item.trend.text}</span>{' '}
              {t('vs previous')}
            </span>
          ) : item.note ? (
            <span className="mx-sub">{item.note}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Activity({ series, days }: { series: DayPoint[]; days: RangeDays }) {
  const t = useT();
  const maxMessages = Math.max(0, ...series.map((point) => point.messages));
  const maxJoins = Math.max(0, ...series.map((point) => point.joins));
  const peak = series.reduce<DayPoint | null>(
    (best, point) => (!best || point.messages > best.messages ? point : best),
    null,
  );
  const first = series[0];
  const last = series.at(-1);
  if (!first || !last || maxMessages === 0) {
    return (
      <Panel title={t('Messages per day')} span={8} id="insights-activity">
        <Empty>{t('No messages counted yet.')}</Empty>
      </Panel>
    );
  }
  const x = (index: number) =>
    (series.length === 1 ? 300 : (index / (series.length - 1)) * 600).toFixed(1);
  const yMessages = (value: number) => (150 - (value / maxMessages) * 130).toFixed(1);
  const yJoins = (value: number) => (150 - (maxJoins ? (value / maxJoins) * 90 : 0)).toFixed(1);
  const line = series.map((point, index) => `${x(index)},${yMessages(point.messages)}`).join(' ');
  const joins = series.map((point, index) => `${x(index)},${yJoins(point.joins)}`).join(' ');

  return (
    <Panel
      title={t('Messages per day')}
      span={8}
      id="insights-activity"
      actions={
        peak ? (
          <span className="mx-sub">
            {t('Peak {count} on {day}', {
              count: peak.messages,
              day: dayLabel(t.locale, peak.day),
            })}
          </span>
        ) : null
      }
    >
      <PanelBody>
        <svg
          viewBox="0 0 600 160"
          role="img"
          aria-label={t('Messages per day over the last {days} days, peak {count}', {
            days,
            count: maxMessages,
          })}
          style={{ width: '100%', height: 180, display: 'block' }}
          preserveAspectRatio="none"
        >
          <g stroke="#27272E" strokeWidth="1">
            <line x1="0" y1="40" x2="600" y2="40" />
            <line x1="0" y1="80" x2="600" y2="80" />
            <line x1="0" y1="120" x2="600" y2="120" />
          </g>
          <polygon points={`0,150 ${line} 600,150`} fill={BLUE} fillOpacity=".12" />
          <polyline
            points={line}
            fill="none"
            stroke={BLUE}
            strokeWidth="2.5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {maxJoins > 0 ? (
            <polyline
              points={joins}
              fill="none"
              stroke={ORANGE}
              strokeWidth="2"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
        <div
          className="mx-sub"
          style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }}
        >
          <span>{dayLabel(t.locale, first.day)}</span>
          <span style={{ display: 'flex', gap: 14 }}>
            <span>
              <span className="mx-dot" style={{ background: BLUE }} /> {t('Messages')}
            </span>
            <span>
              <span className="mx-dot" style={{ background: ORANGE }} /> {t('Joins, scaled')}
            </span>
          </span>
          <span>{dayLabel(t.locale, last.day)}</span>
        </div>
      </PanelBody>
    </Panel>
  );
}

function Channels({ channels }: { channels: { channelId: string; count: number }[] }) {
  const t = useT();
  const channelName = useChannelName();
  const top = channels[0];
  return (
    <Panel title={t('Busiest channels')} span={4} id="insights-channels">
      {!top ? (
        <Empty>{t('No messages counted yet.')}</Empty>
      ) : (
        <div
          className="mx-panel-body"
          role="img"
          aria-label={t('Messages per channel, {channel} is the busiest', {
            channel: channelName(top.channelId),
          })}
          style={{ gap: 9 }}
        >
          {channels.map((channel) => (
            <div
              key={channel.channelId}
              style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span className="mx-ellipsis">{channelName(channel.channelId)}</span>
                <span className="mx-muted">{t.count(channel.count)}</span>
              </div>
              <div className="mx-bar">
                <span
                  style={{
                    width: `${Math.max(2, Math.round((channel.count / top.count) * 100))}%`,
                    background: BLUE,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Heatmap({ heat, timezone, span }: { heat: Heat[]; timezone: string; span: 8 | 12 }) {
  const t = useT();
  const weekdays = weekdayNames(t.locale);
  const max = Math.max(0, ...heat.map((cell) => cell.messages));
  const grid = weekdays.map((_, weekday) =>
    Array.from(
      { length: 24 },
      (_, hour) =>
        heat.find((cell) => cell.weekday === weekday && cell.hour === hour)?.messages ?? 0,
    ),
  );
  const busiest = heat.reduce<Heat | null>(
    (best, cell) => (!best || cell.messages > best.messages ? cell : best),
    null,
  );
  const hour = (value: number) => `${String(value).padStart(2, '0')}:00`;
  return (
    <Panel
      title={t('When people talk')}
      span={span}
      id="insights-heat"
      actions={<span className="mx-sub">{timezone.replaceAll('_', ' ')}</span>}
    >
      {max === 0 || !busiest ? (
        <Empty>{t('No messages counted yet.')}</Empty>
      ) : (
        <div className="mx-panel-body mx-scroll">
          <div
            role="img"
            aria-label={t('Activity by weekday and hour, busiest {day} at {hour}', {
              day: weekdays[busiest.weekday] ?? '',
              hour: hour(busiest.hour),
            })}
            style={{
              display: 'grid',
              gridTemplateColumns: '36px repeat(24, minmax(14px, 1fr))',
              gap: 3,
              minWidth: 520,
              fontSize: 11,
            }}
          >
            <span />
            {HOURS.map((value) => (
              <span key={`h${value}`} className="mx-muted" style={{ textAlign: 'center' }}>
                {value % 3 === 0 ? String(value) : ''}
              </span>
            ))}
            {grid.map((row, weekday) => [
              <span
                key={`d${weekdays[weekday]}`}
                className="mx-muted"
                style={{ alignSelf: 'center' }}
              >
                {weekdays[weekday]}
              </span>,
              ...row.map((messages, value) => (
                <span
                  key={`${weekdays[weekday]}-${hour(value)}`}
                  title={t('{day} {hour}, {count} messages', {
                    day: weekdays[weekday] ?? '',
                    hour: hour(value),
                    count: messages,
                  })}
                  style={{
                    height: 18,
                    borderRadius: 3,
                    background: BLUE,
                    opacity: Math.max(0.08, Math.round((messages / max) * 6) / 6).toFixed(2),
                  }}
                />
              )),
            ])}
          </div>
        </div>
      )}
    </Panel>
  );
}

function Moderation({ weeks, span }: { weeks: Week[]; span: 4 | 6 }) {
  const t = useT();
  const max = Math.max(0, ...weeks.map((week) => week.total));
  const total = weeks.reduce((sum, week) => sum + week.total, 0);
  const automod = share(
    weeks.reduce((sum, week) => sum + week.automod, 0),
    total,
  );
  return (
    <Panel
      title={t('Moderation load')}
      span={span}
      id="insights-moderation"
      actions={<span className="mx-sub">{t('Actions per week')}</span>}
    >
      {total === 0 ? (
        <Empty>{t('No moderation in the last 8 weeks.')}</Empty>
      ) : (
        <PanelBody>
          <div
            role="img"
            aria-label={t('Moderation actions per week for the last 8 weeks, highest {count}', {
              count: max,
            })}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
              gap: 6,
              alignItems: 'end',
              height: 110,
            }}
          >
            {weeks.map((week) => (
              <div
                key={week.start}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: 4,
                  height: '100%',
                }}
              >
                <span style={{ fontSize: 11 }} className="mx-muted">
                  {week.total}
                </span>
                <div
                  style={{
                    width: '100%',
                    height: max ? Math.max(2, Math.round((week.total / max) * 80)) : 2,
                    background: week.total === max ? ORANGE : BLUE,
                    borderRadius: '4px 4px 2px 2px',
                  }}
                />
              </div>
            ))}
          </div>
          {automod !== null ? (
            <span className="mx-sub">
              {t('AutoMod handled {percent}% of all actions', { percent: automod })}
            </span>
          ) : null}
        </PanelBody>
      )}
    </Panel>
  );
}

function Rate({ part, whole }: { part: number; whole: number }) {
  const t = useT();
  const value = share(part, whole);
  if (value === null) return <span className="mx-muted">{t('Too new')}</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 }}>
      <div className="mx-bar" style={{ flex: 1 }}>
        <span style={{ width: `${value}%`, background: rateColor(value) }} />
      </div>
      <span style={{ width: 36, textAlign: 'right' }}>{`${value}%`}</span>
    </div>
  );
}

function RetentionTable({ rows }: { rows: Retention[] }) {
  const t = useT();
  return (
    <Panel
      title={t('Retention by invite')}
      span={12}
      id="insights-retention"
      actions={<span className="mx-sub">{t('Joins, last 90 days')}</span>}
    >
      {rows.length === 0 ? (
        <Empty>{t('No tracked joins yet.')}</Empty>
      ) : (
        <div className="mx-scroll">
          <table className="mx-table">
            <thead>
              <tr>
                <th scope="col">{t('Invite')}</th>
                <th scope="col">{t('Created by')}</th>
                <th scope="col">{t('Joined')}</th>
                <th scope="col">{t('After 7 days')}</th>
                <th scope="col">{t('After 30 days')}</th>
                <th scope="col">{t('Still active')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code ?? 'unknown'}>
                  <td className="mx-mono">{row.code ?? t('Unknown')}</td>
                  <td>{row.inviter ?? <span className="mx-muted">{t('Nobody')}</span>}</td>
                  <td>{t.count(row.joins)}</td>
                  <td>
                    <Rate part={row.stayed7} whole={row.eligible7} />
                  </td>
                  <td>
                    <Rate part={row.stayed30} whole={row.eligible30} />
                  </td>
                  <td>
                    <Rate part={row.active30} whole={row.eligible30} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Settings() {
  const t = useT();
  const { value, set } = useDraft<InsightsConfig>();
  const keep = String(value.retentionDays);
  const keepOptions = keepFor.map((option) => ({ ...option, label: t(option.label) }));
  return (
    <Panel title={t('Settings')} span={12} id="insights-settings">
      <PanelBody>
        <Fields>
          <Field label={t('Keep data for')}>
            <Select
              label={t('Keep data for')}
              value={keep}
              options={
                keepFor.some((option) => option.value === keep)
                  ? keepOptions
                  : [
                      ...keepOptions,
                      {
                        value: keep,
                        label: t('{n, plural, one {# day} other {# days}}', {
                          n: value.retentionDays,
                        }),
                      },
                    ]
              }
              onChange={(next) => set({ retentionDays: Number(next) })}
            />
          </Field>
        </Fields>
        <div className="mx-field">
          <span className="mx-label">{t('Ignored channels')}</span>
          <ChannelMulti
            value={value.excludedChannels}
            kinds={[ChannelType.Text, ChannelType.Announcement, ChannelType.Voice]}
            onChange={(excludedChannels) => set({ excludedChannels })}
          />
        </div>
      </PanelBody>
      <Row title={t('Count bots')}>
        <Switch
          label={t('Count bots')}
          checked={value.countBots}
          onChange={(countBots) => set({ countBots })}
        />
      </Row>
      <Row title={t('Count voice time')}>
        <Switch
          label={t('Count voice time')}
          checked={value.trackVoice}
          onChange={(trackVoice) => set({ trackVoice })}
        />
      </Row>
    </Panel>
  );
}

function Digest({ timezone }: { timezone: string }) {
  const t = useT();
  const { guildId } = useGuild();
  const channelName = useChannelName();
  const { value, set, readOnly, dirty, save } = useDraft<InsightsConfig>();
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const weekdays = weekdayNames(t.locale, 'long');
  const channelId = value.digestChannelId;

  const test = () =>
    start(async () => {
      if (dirty && !(await save())) return;
      const result = await runAction(guildId, 'insights', 'digest.test');
      setStatus(
        result.ok
          ? { message: t('Sent to {channel}.', { channel: channelName(channelId) }), error: false }
          : { message: result.error, error: true },
      );
    });

  return (
    <Panel
      title={t('Weekly digest')}
      span={12}
      id="insights-digest"
      actions={<span className="mx-sub">{timezone.replaceAll('_', ' ')}</span>}
    >
      <PanelBody>
        <Fields>
          <Field label={t('Channel')}>
            <ChannelSelect
              label={t('Channel')}
              none={t('Off')}
              value={channelId}
              onChange={(digestChannelId) => set({ digestChannelId })}
            />
          </Field>
          <Field label={t('Day')}>
            <Select
              label={t('Day')}
              value={String(value.digestDay)}
              options={weekdays.map((name, index) => ({ value: String(index), label: name }))}
              disabled={!channelId}
              onChange={(next) => set({ digestDay: Number(next) })}
            />
          </Field>
          <Field label={t('Time')}>
            <Select
              label={t('Time')}
              value={String(value.digestHour)}
              options={HOURS.map((hour) => ({
                value: String(hour),
                label: `${String(hour).padStart(2, '0')}:00`,
              }))}
              disabled={!channelId}
              onChange={(next) => set({ digestHour: Number(next) })}
            />
          </Field>
        </Fields>
        {readOnly ? null : (
          <div className="mx-inline">
            <button
              type="button"
              className="mx-btn"
              disabled={pending || !channelId}
              onClick={test}
            >
              {t('Send a test digest now')}
            </button>
            <StatusText status={status} />
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

export function InsightsView({
  days,
  timezone,
  stats,
  series,
  channels,
  heat,
  weeks,
  retention,
}: {
  days: RangeDays;
  timezone: string;
  stats: Record<'active' | 'messages' | 'joins' | 'leaves', [number, number]>;
  series: DayPoint[];
  channels: { channelId: string; count: number }[];
  heat: Heat[];
  weeks: Week[];
  retention: Retention[];
}) {
  const t = useT();
  const talk =
    series.some((point) => point.messages > 0) ||
    channels.length > 0 ||
    heat.some((cell) => cell.messages > 0);
  const moderated = weeks.some((week) => week.total > 0);
  const invited = retention.length > 0;
  const data =
    talk ||
    moderated ||
    invited ||
    series.some((point) => point.joins > 0 || point.leaves > 0 || point.active > 0);
  const quiet = !data && Object.values(stats).every(([now, before]) => now === 0 && before === 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <RangePicker days={days} data={data} />
      <Stats stats={stats} retention={retention} quiet={quiet} />
      <Grid>
        {talk || moderated || invited ? null : (
          <Panel span={12} id="insights-empty">
            <Empty mood="sleeping">{t('Nothing counted yet.')}</Empty>
          </Panel>
        )}
        {talk ? (
          <>
            <Activity series={series} days={days} />
            <Channels channels={channels} />
            <Heatmap heat={heat} timezone={timezone} span={moderated ? 8 : 12} />
          </>
        ) : null}
        {moderated ? <Moderation weeks={weeks} span={talk ? 4 : 6} /> : null}
        {invited ? <RetentionTable rows={retention} /> : null}
        <Digest timezone={timezone} />
        <Settings />
      </Grid>
    </div>
  );
}
