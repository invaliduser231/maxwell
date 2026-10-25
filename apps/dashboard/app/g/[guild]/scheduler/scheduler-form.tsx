'use client';

import {
  type ScheduledMessage,
  type ScheduleRule,
  type SchedulerConfig,
  type Weekday,
  weekdays,
} from '@maxwell/core/modules/scheduler';
import {
  formatLocalDateTime,
  toLocal,
  upcomingRuns,
  weekdayOf,
} from '@maxwell/core/stores/scheduler';
import { useRouter } from 'next/navigation';
import { type CSSProperties, type ReactNode, useState, useTransition } from 'react';
import {
  ChannelSelect,
  NumberInput,
  RoleSelect,
  Seg,
  Select,
  Switch,
  Tabs,
  TextArea,
  TextInput,
  TimezoneSelect,
  ToggleRow,
} from '@/components/controls';
import { ChannelType, useChannelName, useGuild } from '@/components/guild';
import { EmbedPreview, MessagePreview } from '@/components/message-preview';
import { useDraft, useReadOnly } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import {
  Avatar,
  Callout,
  Empty,
  Field,
  Fields,
  Grid,
  Panel,
  PanelBody,
  Row,
} from '@/components/ui';
import { runAction } from '@/lib/actions';
import { clock, dayTime, inSentence } from '@/lib/time';
import { cancelReminder } from './actions';
import { ruleLabel, timeOf, weekdayLabels } from './format';

export interface MessageState {
  lastSentAt: string | null;
  lastError: string | null;
}

export interface ReminderView {
  id: string;
  number: number;
  userId: string;
  name: string;
  avatar: string | null;
  channelId: string;
  content: string;
  dueAt: string;
}

type RuleType = ScheduleRule['type'];

type Tab = 'messages' | 'reminders';

const MESSAGE_LIMIT = 25;

const ruleTypes = [
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'interval', label: 'Every few hours' },
] as const;

const tabs = [
  { value: 'messages', label: 'Messages' },
  { value: 'reminders', label: 'Member reminders' },
] as const;

const deliveries = [
  { value: 'dm', label: 'By DM' },
  { value: 'channel', label: 'In the channel' },
] as const;

const sectionHead: CSSProperties = { borderTop: '1px solid var(--mx-line)', paddingTop: 14 };

const longest = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: '730', label: '2 years' },
];

function newId(taken: readonly string[]): string {
  for (;;) {
    const id = `msg-${Math.random().toString(36).slice(2, 8)}`;
    if (!taken.includes(id)) return id;
  }
}

function tomorrowAt(now: number, timezone: string, time: string): string {
  return `${formatLocalDateTime(now + 86_400_000, timezone).slice(0, 10)}T${time}`;
}

function switchRule(rule: ScheduleRule, type: RuleType, now: number, tz: string): ScheduleRule {
  if (rule.type === type) return rule;
  const time = timeOf(rule) || '12:00';
  switch (type) {
    case 'once':
      return { type, at: rule.type === 'interval' ? rule.start : tomorrowAt(now, tz, time) };
    case 'daily':
      return { type, time };
    case 'weekly':
      return { type, time, days: [weekdayOf(toLocal(now, tz))] };
    case 'interval':
      return {
        type,
        hours: 6,
        start: rule.type === 'once' ? rule.at : tomorrowAt(now, tz, time),
      };
  }
}

function TimeInput({
  value,
  onChange,
  label,
  type,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  type: 'time' | 'datetime-local';
}) {
  const readOnly = useReadOnly();
  return (
    <input
      className="mx-input"
      type={type}
      aria-label={label}
      value={value}
      readOnly={readOnly}
      onChange={(event) => {
        if (event.target.value) onChange(event.target.value.slice(0, type === 'time' ? 5 : 16));
      }}
    />
  );
}

function DayPicker({ days, onChange }: { days: Weekday[]; onChange: (next: Weekday[]) => void }) {
  const readOnly = useReadOnly();
  return (
    <div className="mx-field">
      <span className="mx-label" id="scheduler-days">
        Days
      </span>
      <div className="mx-seg" role="group" aria-labelledby="scheduler-days">
        {weekdays.map((day) => {
          const on = days.includes(day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on}
              disabled={readOnly || (on && days.length === 1)}
              onClick={() =>
                onChange(
                  on
                    ? days.filter((entry) => entry !== day)
                    : weekdays.filter((entry) => entry === day || days.includes(entry)),
                )
              }
            >
              {weekdayLabels[day]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RuleEditor({
  rule,
  onChange,
  now,
  tz,
}: {
  rule: ScheduleRule;
  onChange: (next: ScheduleRule) => void;
  now: number;
  tz: string;
}) {
  return (
    <>
      <div className="mx-field">
        <span className="mx-label">Repeat</span>
        <Seg
          label="Repeat"
          value={rule.type}
          options={ruleTypes}
          onChange={(type) => onChange(switchRule(rule, type, now, tz))}
        />
      </div>
      {rule.type === 'weekly' ? (
        <DayPicker days={rule.days} onChange={(days) => onChange({ ...rule, days })} />
      ) : null}
      <Fields>
        {rule.type === 'once' ? (
          <Field label="Date and time">
            <TimeInput
              type="datetime-local"
              label="Date and time"
              value={rule.at}
              onChange={(at) => onChange({ ...rule, at })}
            />
          </Field>
        ) : null}
        {rule.type === 'daily' || rule.type === 'weekly' ? (
          <Field label="Time">
            <TimeInput
              type="time"
              label="Time"
              value={rule.time}
              onChange={(time) => onChange({ ...rule, time })}
            />
          </Field>
        ) : null}
        {rule.type === 'interval' ? (
          <>
            <Field label="Every">
              <NumberInput
                label="Every"
                value={rule.hours}
                min={1}
                max={720}
                suffix="hours"
                onChange={(hours) =>
                  onChange({ ...rule, hours: Math.min(720, Math.max(1, Math.round(hours))) })
                }
              />
            </Field>
            <Field label="Starting">
              <TimeInput
                type="datetime-local"
                label="Starting"
                value={rule.start}
                onChange={(start) => onChange({ ...rule, start })}
              />
            </Field>
          </>
        ) : null}
      </Fields>
    </>
  );
}

function Preview({ message, at }: { message: ScheduledMessage; at: string }) {
  const channelName = useChannelName();
  const ping = message.pingRoleId ? `<@&${message.pingRoleId}>` : null;
  return (
    <div className="mx-preview" role="group" aria-label="Preview">
      <div className="mx-sub">{channelName(message.channelId) || 'No channel'}</div>
      {message.embed ? (
        <MessagePreview time={at} content={ping}>
          <EmbedPreview color="#F26B3A" description={message.content || ' '} />
        </MessagePreview>
      ) : (
        <MessagePreview time={at} content={ping ? `${ping} ${message.content}` : message.content} />
      )}
    </div>
  );
}

function MessageList({
  messages,
  selected,
  onSelect,
  onAdd,
  onToggle,
  now,
  tz,
}: {
  messages: ScheduledMessage[];
  selected: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  now: number;
  tz: string;
}) {
  const { value, set } = useDraft<SchedulerConfig>();
  const { timezone } = useGuild();
  const channelName = useChannelName();
  const readOnly = useReadOnly();
  return (
    <Panel
      title="Scheduled messages"
      span={5}
      id="scheduler-list"
      actions={
        readOnly || messages.length >= MESSAGE_LIMIT ? null : (
          <button type="button" className="mx-btn" onClick={onAdd}>
            New
          </button>
        )
      }
    >
      {messages.map((message) => {
        const next = message.enabled ? upcomingRuns(message.rule, tz, now, 1)[0] : undefined;
        const title = message.name.trim() || message.content.trim().slice(0, 60) || 'Untitled';
        const nextText = !message.enabled
          ? 'off'
          : next === undefined
            ? 'nothing planned'
            : `next ${inSentence(dayTime(next, now, tz))}`;
        const picked = message.id === selected;
        return (
          <div key={message.id} className="mx-row">
            <button
              type="button"
              className="mx-pick mx-row-main"
              aria-pressed={picked}
              onClick={() => onSelect(message.id)}
            >
              <span className="mx-row-title mx-ellipsis">{title}</span>
              <span className="mx-sub">
                {channelName(message.channelId) || 'No channel'},{' '}
                {ruleLabel(message.rule, weekdays)}, {nextText}
              </span>
            </button>
            <Switch
              order
              checked={message.enabled}
              label={`${title} ${message.enabled ? 'on' : 'off'}`}
              onChange={(enabled) => onToggle(message.id, enabled)}
            />
          </div>
        );
      })}
      <Row title="Timezone">
        <div style={{ width: 240, maxWidth: '55%' }}>
          <TimezoneSelect
            value={value.timezone}
            none={`Same as General (${timezone.replaceAll('_', ' ')})`}
            onChange={(next) => set({ timezone: next })}
          />
        </div>
      </Row>
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

function MessageEditor({
  message,
  saved,
  state,
  now,
  tz,
  onChange,
  onDelete,
}: {
  message: ScheduledMessage;
  saved: boolean;
  state: MessageState | undefined;
  now: number;
  tz: string;
  onChange: (patch: Partial<ScheduledMessage>) => void;
  onDelete: () => void;
}) {
  const { guildId } = useGuild();
  const readOnly = useReadOnly();
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();

  const runs = message.enabled ? upcomingRuns(message.rule, tz, now, 3) : [];
  const postNow = () =>
    start(async () => {
      const result = await runAction(guildId, 'scheduler', 'post', { messageId: message.id });
      setStatus(
        result.ok
          ? { message: 'Posting now.', error: false }
          : { message: result.error, error: true },
      );
    });

  return (
    <Panel
      title={message.name.trim() || 'Untitled message'}
      span={7}
      id="scheduler-edit"
      actions={
        readOnly ? null : (
          <>
            <StatusText status={status} />
            {saved ? (
              <button type="button" className="mx-btn" disabled={pending} onClick={postNow}>
                Post now
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
        {state?.lastError ? (
          <Callout tone="warn">Last post failed. {state.lastError}</Callout>
        ) : null}
        <Field label="Name" aside={`${message.name.length} / 100`}>
          <TextInput
            value={message.name}
            maxLength={100}
            placeholder="Movie night reminder"
            onChange={(name) => onChange({ name })}
          />
        </Field>
        <Fields>
          <Field label="Channel">
            <ChannelSelect
              value={message.channelId || null}
              none={message.channelId ? null : 'Pick a channel'}
              onChange={(channelId) => onChange({ channelId: channelId ?? '' })}
            />
          </Field>
          <Field label="Ping">
            <RoleSelect
              value={message.pingRoleId}
              none="Nobody"
              onChange={(pingRoleId) => onChange({ pingRoleId })}
            />
          </Field>
        </Fields>
        <Field label="Message" aside={`${message.content.length} / 2000`}>
          <TextArea
            value={message.content}
            rows={4}
            maxLength={2000}
            onChange={(content) => onChange({ content })}
          />
        </Field>
        <ToggleRow
          order
          title="Send as embed"
          checked={message.embed}
          onChange={(embed) => onChange({ embed })}
        />
      </PanelBody>

      <Section title="When">
        <RuleEditor rule={message.rule} now={now} tz={tz} onChange={(rule) => onChange({ rule })} />
        <span className="mx-hint">
          {runs.length > 0
            ? `Next ${runs.map((run) => inSentence(dayTime(run, now, tz))).join(', ')}`
            : message.enabled
              ? 'Nothing planned. The time has passed.'
              : 'Off'}
          {`. Times in ${tz.replaceAll('_', ' ')}`}
        </span>
      </Section>

      <Section title="Preview">
        <Preview message={message} at={runs[0] !== undefined ? clock(runs[0], tz) : ''} />
        {state?.lastSentAt ? (
          <span className="mx-sub">
            Last posted {inSentence(dayTime(state.lastSentAt, now, tz))}
          </span>
        ) : null}
      </Section>
    </Panel>
  );
}

function Reminders({
  reminders,
  total,
  dm,
  on,
  prefix,
  now,
  tz,
}: {
  reminders: ReminderView[];
  total: number;
  dm: boolean;
  on: boolean;
  prefix: string;
  now: number;
  tz: string;
}) {
  const { guildId } = useGuild();
  const channelName = useChannelName();
  const readOnly = useReadOnly();
  const router = useRouter();
  const [gone, setGone] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const shown = reminders.filter((reminder) => !gone.includes(reminder.id));
  const count = Math.max(0, total - gone.length);

  return (
    <Panel
      title="Member reminders"
      span={7}
      id="scheduler-reminders"
      actions={
        <>
          <StatusText status={status} />
          {count > 0 ? <span className="mx-sub">{`${count} active`}</span> : null}
        </>
      }
    >
      {shown.length === 0 ? (
        <Empty mood="sleeping">
          {on ? (
            <>
              <p style={{ margin: '0 0 10px' }}>No reminders set.</p>
              <span className="mx-kbd">{`${prefix}remind 2h stretch`}</span>
            </>
          ) : (
            'Member reminders are off.'
          )}
        </Empty>
      ) : (
        <div className="mx-scroll">
          <table className="mx-table">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Reminder</th>
                <th scope="col">Due</th>
                <th scope="col">Where</th>
                <th scope="col">
                  <span className="mx-sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((reminder) => (
                <tr key={reminder.id}>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar src={reminder.avatar} name={reminder.name} size={22} />
                      {reminder.name}
                    </span>
                  </td>
                  <td style={{ maxWidth: 280, overflowWrap: 'anywhere' }}>
                    <span className="mx-mono mx-muted">#{reminder.number}</span> {reminder.content}
                  </td>
                  <td className="mx-muted" style={{ whiteSpace: 'nowrap' }}>
                    {dayTime(reminder.dueAt, now, tz)}
                  </td>
                  <td className="mx-muted">{dm ? 'DM' : channelName(reminder.channelId)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {readOnly ? null : (
                      <TwoStep
                        ghost
                        label="Cancel"
                        disabled={pending}
                        run={() =>
                          start(async () => {
                            const result = await cancelReminder(guildId, reminder.id);
                            if (result.ok) {
                              setGone((current) => [...current, reminder.id]);
                              setStatus(null);
                              router.refresh();
                            } else {
                              setStatus({ message: result.error, error: true });
                            }
                          })
                        }
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {count > shown.length ? (
            <div className="mx-panel-body">
              <span className="mx-sub">{`${count - shown.length} more due later`}</span>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

function Settings() {
  const { value, set } = useDraft<SchedulerConfig>();
  const days = String(value.maxReminderDays);
  return (
    <Panel title="Settings" span={5} id="scheduler-settings">
      <PanelBody>
        <ToggleRow
          order
          title="Member reminders"
          checked={value.reminders}
          onChange={(reminders) => set({ reminders })}
        />
        {value.reminders ? (
          <>
            <Fields>
              <Field label="Per member">
                <NumberInput
                  value={value.maxRemindersPerMember}
                  min={1}
                  max={100}
                  onChange={(next) =>
                    set({ maxRemindersPerMember: Math.min(100, Math.max(1, Math.round(next))) })
                  }
                />
              </Field>
              <Field label="Longest">
                <Select
                  value={days}
                  options={
                    longest.some((option) => option.value === days)
                      ? longest
                      : [...longest, { value: days, label: `${days} days` }]
                  }
                  onChange={(next) => set({ maxReminderDays: Number(next) })}
                />
              </Field>
            </Fields>
            <div className="mx-field">
              <span className="mx-label">Deliver</span>
              <Seg
                label="Deliver"
                value={value.reminderDelivery === 'dm' ? 'dm' : 'channel'}
                options={deliveries}
                onChange={(delivery) => set({ reminderDelivery: delivery })}
              />
            </div>
          </>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

export function SchedulerForm({
  now,
  prefix,
  savedIds,
  states,
  reminders,
  total,
}: {
  now: number;
  prefix: string;
  savedIds: string[];
  states: Record<string, MessageState>;
  reminders: ReminderView[];
  total: number;
}) {
  const { value, update, readOnly } = useDraft<SchedulerConfig>();
  const guild = useGuild();
  const tz = value.timezone ?? guild.timezone;
  const [tab, setTab] = useState<Tab>('messages');
  const [selected, setSelected] = useState<string | null>(value.messages[0]?.id ?? null);
  const current =
    value.messages.find((message) => message.id === selected) ?? value.messages[0] ?? null;

  const patch = (id: string, change: Partial<ScheduledMessage>) =>
    update((previous) => ({
      ...previous,
      messages: previous.messages.map((message) =>
        message.id === id ? { ...message, ...change } : message,
      ),
    }));

  const add = () => {
    const id = newId(value.messages.map((message) => message.id));
    const channel = guild.channels.find(
      (entry) => entry.type === ChannelType.Text || entry.type === ChannelType.Announcement,
    );
    const message: ScheduledMessage = {
      id,
      name: '',
      enabled: true,
      channelId: channel?.id ?? '',
      content: '',
      embed: false,
      pingRoleId: null,
      rule: { type: 'once', at: tomorrowAt(now, tz, '12:00') },
    };
    update((previous) => ({ ...previous, messages: [...previous.messages, message] }));
    setSelected(id);
  };

  const remove = () => {
    if (!current) return;
    const rest = value.messages.filter((message) => message.id !== current.id);
    update((previous) => ({
      ...previous,
      messages: previous.messages.filter((message) => message.id !== current.id),
    }));
    setSelected(rest[0]?.id ?? null);
  };

  return (
    <>
      <Tabs label="Scheduler" value={tab} options={tabs} onChange={setTab} />
      {tab === 'messages' ? (
        current ? (
          <Grid>
            <MessageList
              messages={value.messages}
              selected={current.id}
              onSelect={setSelected}
              onAdd={add}
              onToggle={(id, enabled) => patch(id, { enabled })}
              now={now}
              tz={tz}
            />
            <MessageEditor
              key={current.id}
              message={current}
              saved={savedIds.includes(current.id)}
              state={states[current.id]}
              now={now}
              tz={tz}
              onChange={(change) => patch(current.id, change)}
              onDelete={remove}
            />
          </Grid>
        ) : (
          <Grid>
            <Panel id="scheduler-empty">
              <Empty
                mood="sleeping"
                action={
                  readOnly ? null : (
                    <button type="button" className="mx-btn mx-btn-primary" onClick={add}>
                      New message
                    </button>
                  )
                }
              >
                Nothing scheduled yet.
              </Empty>
            </Panel>
          </Grid>
        )
      ) : (
        <Grid>
          <Reminders
            reminders={reminders}
            total={total}
            dm={value.reminderDelivery === 'dm'}
            on={value.reminders}
            prefix={prefix}
            now={now}
            tz={tz}
          />
          <Settings />
        </Grid>
      )}
    </>
  );
}
