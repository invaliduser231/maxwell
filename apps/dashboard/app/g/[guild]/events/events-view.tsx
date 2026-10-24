'use client';

import type { EventsConfig, Recurrence } from '@maxwell/core/modules/events';
import type { EventStatus, PollStatus, RsvpCounts } from '@maxwell/core/stores/events';
import {
  addDays,
  formatLocalDateTime,
  fromLocal,
  parseLocalDateTime,
  toLocal,
  weekdayOf,
} from '@maxwell/core/stores/scheduler';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  ChannelSelect,
  RoleSelect,
  Seg,
  Select,
  Tabs,
  TextArea,
  TextInput,
} from '@/components/controls';
import { ChannelType, useChannelName, useGuild } from '@/components/guild';
import { EmbedPreview, MessagePreview } from '@/components/message-preview';
import { useDraft, useReadOnly } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import { Avatar, Callout, Field, Fields, Grid, Panel, PanelBody } from '@/components/ui';
import { clock, longDate, minutesLabel } from '@/lib/time';
import { cancelEvent, type EventDraft, saveEvent } from './actions';
import { PollsTab } from './polls';
import { SettingsTab } from './settings';
import { dayHeading, isoDate, parseIsoDate, recurrenceLabels, weekHeading, weekOf } from './time';

export interface Person {
  id: string;
  name: string;
  avatar: string | null;
}

export interface EventView {
  id: string;
  number: number;
  title: string;
  description: string;
  startsAt: string;
  durationMinutes: number | null;
  recurrence: Recurrence;
  location: string | null;
  voiceChannelId: string | null;
  channelId: string | null;
  pingRoleId: string | null;
  posted: boolean;
  status: EventStatus;
  counts: RsvpCounts;
  going: Person[];
}

export interface Occurrence {
  eventId: string;
  at: string;
  current: boolean;
}

export interface PollView {
  id: string;
  number: number;
  question: string;
  options: string[];
  status: PollStatus;
  anonymous: boolean;
  multiple: boolean;
  endsAt: string | null;
  counts: number[];
  voters: number;
}

type Tab = 'events' | 'polls' | 'settings';

const tabs = [
  { value: 'events', label: 'Events' },
  { value: 'polls', label: 'Polls' },
  { value: 'settings', label: 'Settings' },
] as const;

const repeats: { value: Recurrence; label: string }[] = [
  { value: 'none', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const lengths = [30, 60, 90, 120, 180, 240, 1440];

const weekdayNames: Record<string, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

function ordinal(day: number): string {
  const tail = day % 100;
  if (tail >= 11 && tail <= 13) return `${day}th`;
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`;
}

function draftOf(event: EventView | null, now: number, timezone: string): EventDraft {
  if (!event) {
    const tomorrow = formatLocalDateTime(now + 86_400_000, timezone).slice(0, 10);
    return {
      id: null,
      title: '',
      description: '',
      start: `${tomorrow}T20:00`,
      durationMinutes: null,
      recurrence: 'none',
      location: null,
      voiceChannelId: null,
      channelId: null,
      pingRoleId: null,
    };
  }
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    start: formatLocalDateTime(Date.parse(event.startsAt), timezone),
    durationMinutes: event.durationMinutes,
    recurrence: event.recurrence,
    location: event.location,
    voiceChannelId: event.voiceChannelId,
    channelId: event.channelId,
    pingRoleId: event.pingRoleId,
  };
}

function startOf(draft: EventDraft, timezone: string): number | null {
  const local = parseLocalDateTime(draft.start);
  return local ? fromLocal(local, timezone) : null;
}

function repeatLine(recurrence: Recurrence, start: number | null, timezone: string): string {
  if (recurrence === 'none' || start === null) return 'One time only';
  if (recurrence === 'daily') return 'Repeats every day';
  const local = toLocal(start, timezone);
  if (recurrence === 'weekly') return `Repeats every ${weekdayNames[weekdayOf(local)]}`;
  return `Repeats every month on the ${ordinal(local.day)}`;
}

function useWhere(): (draft: Pick<EventDraft, 'voiceChannelId' | 'location'>) => string | null {
  const { channels } = useGuild();
  return (draft) => {
    if (draft.voiceChannelId) {
      return (
        channels.find((channel) => channel.id === draft.voiceChannelId)?.name ?? 'Deleted channel'
      );
    }
    return draft.location?.trim() || null;
  };
}

function Chevron({ back }: { back?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={back ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WeekPanel({
  now,
  timezone,
  week,
  events,
  slots,
  current,
  onPick,
  onNew,
}: {
  now: number;
  timezone: string;
  week: string;
  events: EventView[];
  slots: Occurrence[];
  current: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
}) {
  const router = useRouter();
  const readOnly = useReadOnly();
  const [pending, start] = useTransition();
  const monday = parseIsoDate(week) ?? toLocal(now, timezone);
  const today = isoDate(toLocal(now, timezone));
  const thisWeek = weekOf(now, timezone);
  const go = (target: string) => start(() => router.push(`?week=${target}`, { scroll: false }));
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  const quiet = slots.length === 0;

  return (
    <Panel
      title={`Week of ${weekHeading(monday)}`}
      id="events-week"
      actions={
        <>
          {week !== thisWeek ? (
            <button
              type="button"
              className="mx-btn mx-btn-ghost"
              disabled={pending}
              onClick={() => go(thisWeek)}
            >
              This week
            </button>
          ) : null}
          <button
            type="button"
            className="mx-btn mx-btn-ghost"
            aria-label="Previous week"
            disabled={pending}
            onClick={() => go(isoDate(addDays(monday, -7)))}
          >
            <Chevron back />
          </button>
          <button
            type="button"
            className="mx-btn mx-btn-ghost"
            aria-label="Next week"
            disabled={pending}
            onClick={() => go(isoDate(addDays(monday, 7)))}
          >
            <Chevron />
          </button>
          {readOnly ? null : (
            <button type="button" className="mx-btn mx-btn-primary" onClick={onNew}>
              New event
            </button>
          )}
        </>
      }
    >
      <div className="mx-scroll">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(110px, 1fr))',
            minWidth: 770,
            padding: '4px 8px 10px',
          }}
        >
          {days.map((day, index) => {
            const key = isoDate(day);
            const isToday = key === today;
            const items = slots.filter(
              (slot) => isoDate(toLocal(Date.parse(slot.at), timezone)) === key,
            );
            return (
              <div
                key={key}
                style={{
                  borderLeft: index === 0 ? 'none' : '1px solid var(--mx-line)',
                  padding: '6px 8px',
                  minHeight: quiet ? 44 : 128,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <span
                  className="mx-sub"
                  style={{
                    color: isToday ? 'var(--mx-north)' : undefined,
                    fontWeight: isToday ? 600 : undefined,
                  }}
                >
                  {dayHeading(day)}
                </span>
                {items.map((slot) => {
                  const event = events.find((entry) => entry.id === slot.eventId);
                  if (!event) return null;
                  const picked = event.id === current;
                  const over = event.status === 'ended' || Date.parse(slot.at) < now;
                  return (
                    <button
                      key={`${slot.eventId}-${slot.at}`}
                      type="button"
                      aria-pressed={picked}
                      onClick={() => onPick(event.id)}
                      style={{
                        font: 'inherit',
                        textAlign: 'left',
                        cursor: 'pointer',
                        border: 0,
                        boxShadow: picked ? 'inset 0 0 0 1px var(--mx-north)' : 'none',
                        background: picked ? 'rgba(242, 107, 58, 0.12)' : 'var(--mx-inset)',
                        color: 'var(--mx-text)',
                        borderRadius: 8,
                        padding: '6px 8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                        opacity: over && !picked ? 0.6 : 1,
                      }}
                    >
                      <span style={{ fontSize: 12, color: 'var(--mx-text-2)' }}>
                        {clock(Date.parse(slot.at), timezone)}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>
                        <span className="mx-mono mx-muted">#{event.number}</span> {event.title}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--mx-muted)' }}>
                        {slot.current
                          ? `${event.counts.going} going`
                          : recurrenceLabels[event.recurrence]}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {quiet ? (
        <div className="mx-panel-body" style={{ paddingTop: 0 }}>
          <span className="mx-sub">Nothing planned this week.</span>
        </div>
      ) : null}
    </Panel>
  );
}

function EventEditor({
  event,
  draft,
  timezone,
  week,
  onChange,
}: {
  event: EventView | null;
  draft: EventDraft;
  timezone: string;
  week: string;
  onChange: (patch: Partial<EventDraft>) => void;
}) {
  const { guildId } = useGuild();
  const { value: config } = useDraft<EventsConfig>();
  const channelName = useChannelName();
  const readOnly = useReadOnly();
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  const [tried, setTried] = useState(false);
  const [pending, start] = useTransition();
  const length = draft.durationMinutes === null ? '' : String(draft.durationMinutes);
  const lengthOptions = [
    { value: '', label: `Default (${minutesLabel(config.defaultDurationMinutes)})` },
    ...[...new Set([...lengths, ...(draft.durationMinutes ? [draft.durationMinutes] : [])])]
      .sort((a, b) => a - b)
      .map((minutes) => ({ value: String(minutes), label: minutesLabel(minutes) })),
  ];
  const noChannel = !draft.channelId && !config.channelId;

  const save = () =>
    start(async () => {
      setTried(true);
      setStatus(null);
      const result = await saveEvent(guildId, draft);
      if (!result.ok) {
        setStatus({ message: result.error, error: true });
        return;
      }
      setStatus({ message: 'Sorted.', error: false });
      const id = result.data?.id ?? '';
      const at = result.data ? Date.parse(result.data.startsAt) : Date.now();
      router.replace(`?week=${weekOf(at, timezone)}&event=${id}`, { scroll: false });
    });

  const cancel = () =>
    start(async () => {
      const result = await cancelEvent(guildId, event?.id ?? '');
      if (!result.ok) {
        setStatus({ message: result.error, error: true });
        return;
      }
      router.replace(`?week=${week}`, { scroll: false });
    });

  return (
    <Panel
      title={
        event ? (
          <>
            <span className="mx-mono mx-muted">#{event.number}</span>{' '}
            {draft.title.trim() || 'Untitled event'}
          </>
        ) : (
          draft.title.trim() || 'New event'
        )
      }
      span={7}
      id="events-editor"
      actions={
        event ? (
          <>
            <a
              className="mx-btn mx-btn-ghost"
              href={`/g/${guildId}/events/${event.id}/ics`}
              download
            >
              Add to calendar
            </a>
            {event.status === 'scheduled' && !readOnly ? (
              <TwoStep danger label="Cancel event" disabled={pending} run={cancel} />
            ) : null}
          </>
        ) : null
      }
    >
      <PanelBody>
        {event?.status === 'ended' ? <Callout>This event is over.</Callout> : null}
        <Field label="Title" aside={`${draft.title.length} / 200`}>
          <TextInput
            value={draft.title}
            maxLength={200}
            placeholder="Movie night"
            onChange={(title) => onChange({ title })}
          />
        </Field>
        <Fields>
          <Field label="Starts" hint={`Times in ${timezone.replaceAll('_', ' ')}`}>
            <input
              className="mx-input"
              type="datetime-local"
              value={draft.start}
              readOnly={readOnly}
              onChange={(next) => {
                if (next.target.value) onChange({ start: next.target.value.slice(0, 16) });
              }}
            />
          </Field>
          <Field label="Length">
            <Select
              value={length}
              options={lengthOptions}
              onChange={(next) => onChange({ durationMinutes: next ? Number(next) : null })}
            />
          </Field>
        </Fields>
        <div className="mx-field">
          <span className="mx-label">Repeats</span>
          <Seg
            label="Repeats"
            value={draft.recurrence}
            options={repeats}
            onChange={(recurrence) => onChange({ recurrence })}
          />
        </div>
        <Fields>
          <Field label="Voice channel">
            <ChannelSelect
              value={draft.voiceChannelId}
              kinds={[ChannelType.Voice]}
              none="No voice channel"
              onChange={(voiceChannelId) => onChange({ voiceChannelId })}
            />
          </Field>
          {draft.voiceChannelId ? null : (
            <Field label="Location">
              <TextInput
                value={draft.location ?? ''}
                maxLength={200}
                placeholder="Optional"
                onChange={(location) => onChange({ location: location || null })}
              />
            </Field>
          )}
          <div className="mx-field">
            <Field label="Announce in">
              <ChannelSelect
                value={draft.channelId}
                none={
                  config.channelId
                    ? `Default (${channelName(config.channelId)})`
                    : 'Default channel'
                }
                onChange={(channelId) => onChange({ channelId })}
              />
            </Field>
            {tried && noChannel ? (
              <span className="mx-field-error">Pick a channel here or a default in Settings.</span>
            ) : null}
          </div>
          <Field label="Ping">
            <RoleSelect
              value={draft.pingRoleId}
              none="Nobody"
              onChange={(pingRoleId) => onChange({ pingRoleId })}
            />
          </Field>
        </Fields>
        <Field label="Description" aside={`${draft.description.length} / 2000`}>
          <TextArea
            value={draft.description}
            rows={3}
            maxLength={2000}
            onChange={(description) => onChange({ description })}
          />
        </Field>
        {readOnly ? null : (
          <div className="mx-inline">
            <button
              type="button"
              className="mx-btn mx-btn-primary"
              disabled={pending || !draft.title.trim()}
              onClick={save}
            >
              {event ? 'Save event' : 'Create event'}
            </button>
            <StatusText status={status} />
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

function RsvpPanel({ event, timezone }: { event: EventView; timezone: string }) {
  const more = event.counts.going - event.going.length;
  const none = event.counts.going + event.counts.maybe + event.counts.no === 0;
  return (
    <Panel
      title="RSVP"
      id="events-rsvp"
      actions={<span className="mx-sub">{longDate(Date.parse(event.startsAt), timezone)}</span>}
    >
      <div
        className={none ? 'mx-stat-quiet' : undefined}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
      >
        <div className="mx-stat">
          <span className="mx-stat-label">Going</span>
          <span className={none ? 'mx-stat-value' : 'mx-stat-value mx-up'}>
            {event.counts.going}
          </span>
        </div>
        <div className="mx-stat">
          <span className="mx-stat-label">Maybe</span>
          <span className="mx-stat-value">{event.counts.maybe}</span>
        </div>
        <div className="mx-stat">
          <span className="mx-stat-label">Can't</span>
          <span className="mx-stat-value mx-muted">{event.counts.no}</span>
        </div>
      </div>
      {event.going.length > 0 ? (
        <div className="mx-panel-body" style={{ borderTop: '1px solid var(--mx-line)' }}>
          <div className="mx-chips">
            {event.going.map((person) => (
              <span key={person.id} className="mx-chip">
                <Avatar src={person.avatar} name={person.name} size={18} />
                {person.name}
              </span>
            ))}
            {more > 0 ? <span className="mx-chip">{`${more} more`}</span> : null}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function PreviewPanel({
  draft,
  event,
  timezone,
}: {
  draft: EventDraft;
  event: EventView | null;
  timezone: string;
}) {
  const { value: config } = useDraft<EventsConfig>();
  const channelName = useChannelName();
  const where = useWhere()(draft);
  const start = startOf(draft, timezone);
  const channel = draft.channelId ?? config.channelId;
  const counts = event?.counts ?? { going: 0, maybe: 0, no: 0 };
  const length = minutesLabel(draft.durationMinutes ?? config.defaultDurationMinutes);
  const cancelled = event?.status === 'cancelled';
  return (
    <Panel title={channel ? `In ${channelName(channel)}` : 'Preview'} id="events-preview">
      <PanelBody>
        <div className="mx-preview">
          <MessagePreview avatarSize={30}>
            <EmbedPreview
              color={cancelled ? '#4A4A55' : '#F26B3A'}
              title={
                <span style={{ overflowWrap: 'anywhere' }}>
                  {draft.title.trim() || 'New event'}
                </span>
              }
              description={draft.description.trim()}
              footer={repeatLine(draft.recurrence, start, timezone)}
            >
              <span>
                {[start === null ? null : longDate(start, timezone), length, where]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            </EmbedPreview>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="mx-chip">{`Going ${counts.going}`}</span>
              <span className="mx-chip">{`Maybe ${counts.maybe}`}</span>
              <span className="mx-chip">{`Can't ${counts.no}`}</span>
            </div>
          </MessagePreview>
        </div>
      </PanelBody>
    </Panel>
  );
}

function EventsTab({
  now,
  timezone,
  week,
  events,
  slots,
  selected,
}: {
  now: number;
  timezone: string;
  week: string;
  events: EventView[];
  slots: Occurrence[];
  selected: string | null;
}) {
  const [current, setCurrent] = useState<string | null>(selected);
  const event = events.find((entry) => entry.id === current) ?? null;
  const [draft, setDraft] = useState<EventDraft>(() => draftOf(event, now, timezone));

  const pick = (id: string | null) => {
    setCurrent(id);
    setDraft(draftOf(events.find((entry) => entry.id === id) ?? null, now, timezone));
  };

  return (
    <>
      <WeekPanel
        now={now}
        timezone={timezone}
        week={week}
        events={events}
        slots={slots}
        current={current}
        onPick={pick}
        onNew={() => pick(null)}
      />
      <Grid>
        <EventEditor
          key={current ?? 'new'}
          event={event}
          draft={draft}
          timezone={timezone}
          week={week}
          onChange={(patch) => setDraft((previous) => ({ ...previous, ...patch }))}
        />
        <div className="mx-s5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {event ? <RsvpPanel event={event} timezone={timezone} /> : null}
          <PreviewPanel draft={draft} event={event} timezone={timezone} />
        </div>
      </Grid>
    </>
  );
}

export function EventsView({
  now,
  timezone,
  week,
  events,
  slots,
  selected,
  polls,
  enabled,
}: {
  enabled: boolean;
  now: number;
  timezone: string;
  week: string;
  events: EventView[];
  slots: Occurrence[];
  selected: string | null;
  polls: PollView[];
}) {
  const [tab, setTab] = useState<Tab>('events');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Tabs label="Events and polls" value={tab} options={tabs} onChange={setTab} />
      {tab === 'events' ? (
        <EventsTab
          now={now}
          timezone={timezone}
          week={week}
          events={events}
          slots={slots}
          selected={selected}
        />
      ) : null}
      {tab === 'polls' ? <PollsTab polls={polls} enabled={enabled} /> : null}
      {tab === 'settings' ? <SettingsTab /> : null}
    </div>
  );
}
