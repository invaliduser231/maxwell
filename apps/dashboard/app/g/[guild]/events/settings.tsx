'use client';

import type { EventsConfig } from '@maxwell/core/modules/events';
import {
  ChannelSelect,
  NumberInput,
  Select,
  TextInput,
  TimezoneSelect,
  ToggleRow,
} from '@/components/controls';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { useDraft } from '@/components/module-shell';
import { Field, Fields, Grid, Panel, PanelBody } from '@/components/ui';
import type { Key } from '@/lib/i18n';
import { minutesLabel } from '@/lib/time';

const lengths = [30, 60, 90, 120, 180, 240, 1440];

const reminders: { value: string; label: Key }[] = [
  { value: '0', label: 'Off' },
  { value: '15', label: '15 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '120', label: '2 hours before' },
  { value: '1440', label: '1 day before' },
];

const pollLengths: { value: string; label: Key }[] = [
  { value: '60', label: '1 hour' },
  { value: '1440', label: '24 hours' },
  { value: '4320', label: '3 days' },
  { value: '10080', label: '7 days' },
  { value: '43200', label: '30 days' },
  { value: '0', label: 'No end' },
];

function withCurrent(
  options: { value: string; label: string }[],
  value: string,
  label: string,
): { value: string; label: string }[] {
  return options.some((option) => option.value === value)
    ? options
    : [...options, { value, label }];
}

export function SettingsTab() {
  const t = useT();
  const { value, set } = useDraft<EventsConfig>();
  const { timezone } = useGuild();
  const length = String(value.defaultDurationMinutes);
  const reminder = String(value.reminderMinutes);
  const pollLength = String(value.pollDurationMinutes);
  const translate = (list: { value: string; label: Key }[]) =>
    list.map((entry) => ({ ...entry, label: t(entry.label) }));

  return (
    <Grid>
      <Panel title={t('Events')} span={6} id="events-settings">
        <PanelBody>
          <Fields>
            <Field label={t('Announce in')}>
              <ChannelSelect
                value={value.channelId}
                none={t('Pick a channel')}
                onChange={(channelId) => set({ channelId })}
              />
            </Field>
            <Field label={t('Timezone')}>
              <TimezoneSelect
                value={value.timezone}
                none={t('Same as General ({zone})', { zone: timezone.replaceAll('_', ' ') })}
                onChange={(next: string | null) => set({ timezone: next })}
              />
            </Field>
            <Field label={t('Default length')}>
              <Select
                value={length}
                options={withCurrent(
                  lengths.map((minutes) => ({
                    value: String(minutes),
                    label: minutesLabel(t, minutes),
                  })),
                  length,
                  minutesLabel(t, value.defaultDurationMinutes),
                )}
                onChange={(next) => set({ defaultDurationMinutes: Number(next) })}
              />
            </Field>
            <Field label={t('Reminder DM')}>
              <Select
                value={reminder}
                options={withCurrent(
                  translate(reminders),
                  reminder,
                  t('{count} minutes before', { count: value.reminderMinutes }),
                )}
                onChange={(next) => set({ reminderMinutes: Number(next) })}
              />
            </Field>
          </Fields>
          <div className="mx-field">
            <span className="mx-label">{t('RSVP reactions')}</span>
            <div
              style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}
            >
              <TextInput
                label={t('Going reaction')}
                value={value.rsvp.going}
                maxLength={80}
                onChange={(going) => set({ rsvp: { ...value.rsvp, going } })}
              />
              <TextInput
                label={t('Maybe reaction')}
                value={value.rsvp.maybe}
                maxLength={80}
                onChange={(maybe) => set({ rsvp: { ...value.rsvp, maybe } })}
              />
              <TextInput
                label={t("Can't reaction")}
                value={value.rsvp.no}
                maxLength={80}
                onChange={(no) => set({ rsvp: { ...value.rsvp, no } })}
              />
            </div>
          </div>
          <Field label={t('Reward for everyone going')}>
            <NumberInput
              value={value.rewardAmount}
              min={0}
              max={1_000_000}
              onChange={(next) =>
                set({ rewardAmount: Math.min(1_000_000, Math.max(0, Math.round(next))) })
              }
            />
          </Field>
        </PanelBody>
      </Panel>
      <Panel title={t('Polls')} span={6} id="polls-settings">
        <PanelBody>
          <Fields>
            <Field label={t('Post polls in')}>
              <ChannelSelect
                value={value.pollChannelId}
                none={t('Same as events')}
                onChange={(pollChannelId) => set({ pollChannelId })}
              />
            </Field>
            <Field label={t('Default length')}>
              <Select
                value={pollLength}
                options={withCurrent(
                  translate(pollLengths),
                  pollLength,
                  t('{count} minutes', { count: value.pollDurationMinutes }),
                )}
                onChange={(next) => set({ pollDurationMinutes: Number(next) })}
              />
            </Field>
          </Fields>
          <ToggleRow
            title={t('Result image when a poll ends')}
            checked={value.pollResultImage}
            onChange={(pollResultImage) => set({ pollResultImage })}
          />
          <ToggleRow
            title={t('Vote receipts by DM')}
            sub={t('For anonymous polls')}
            checked={value.voteReceipts}
            onChange={(voteReceipts) => set({ voteReceipts })}
          />
        </PanelBody>
      </Panel>
    </Grid>
  );
}
